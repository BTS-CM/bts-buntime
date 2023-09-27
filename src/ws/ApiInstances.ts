import ChainWebSocket from "./ChainWebSocket";
import GrapheneApi from "./GrapheneApi";
import ChainConfig from "./ChainConfig";

type OptionalApis = {
  enableDatabase?: boolean;
  enableHistory?: boolean;
  enableNetworkBroadcast?: boolean;
  enableCrypto?: boolean;
  enableOrders?: boolean;
};

type CallbackStatus = (status: string) => void;

type ApiObject = {
  url: string;
  ws_rpc?: ChainWebSocket;
  _db?: GrapheneApi;
  _hist?: GrapheneApi;
  _net?: GrapheneApi;
  _orders?: GrapheneApi;
  _crypt?: GrapheneApi;
  init_promise?: Promise<any>;
  chain_id?: string;
  closeCb?: any;
};

type ApiInstance = {
  connect: (
    wssURL: string,
    connectTimeout: number,
    optionalApis: OptionalApis
  ) => Promise<void>;
  init: () => Promise<void>;
  close: () => Promise<void>;
  db_api: () => GrapheneApi;
  network_api: () => GrapheneApi;
  history_api: () => GrapheneApi;
  crypto_api: () => GrapheneApi;
  orders_api: () => GrapheneApi;
  get: (name: string) => any;
  setRpcConnectionStatusCallback: (callback: CallbackStatus) => void;
  setAutoReconnect: (auto: boolean) => void;
  chainId: () => string | Error;
};

/**
 * Template for initializing a new API instance
 */
const newApis = (): ApiInstance => {
  let Api: ApiObject = {};
  let autoReconnect = false;
  let callbackStatus: CallbackStatus | null = null;
  let currentOptionalApis: OptionalApis = {
    enableDatabase: false,
    enableHistory: false,
    enableNetworkBroadcast: false,
    enableCrypto: false,
    enableOrders: false
  };

  const close = async () => {
    if (
      Api &&
      Api.ws_rpc &&
      Api.ws_rpc.ws && 
      Api.ws_rpc.ws.readyState === 1
    ) {
      await Api.ws_rpc.close();
    }
    Api = {}
    autoReconnect = false
    callbackStatus = null
  }

  const connect = (
    wssURL: string,
    connectTimeout: number,
    optionalApis: OptionalApis
  ) => {
    return new Promise((resolve, reject) => {
      if (!wssURL || !wssURL.length) {
        reject(new Error("Websocket URL not set"));
      }
  
      const hasOptApis = optionalApis ? Object.keys(optionalApis).length > 0 : false;
      const hasTrueApis = hasOptApis ? Object.values(optionalApis).some(val => val === true) : false;
  
      if (!hasTrueApis) {
        // At least one optional Api is required
        reject(new Error("Please configure at least one API"));
      }
  
      currentOptionalApis = optionalApis;
  
      Api.url = wssURL;
      Api.ws_rpc = new ChainWebSocket(
        wssURL,
        Api.callbackStatus,
        connectTimeout,
        autoReconnect,
        (closed: any) => {
          Api._db &&
            !closed &&
            Api._db.exec("get_objects", [["2.1.0"]]).catch((e: any) => {}); // keepalive function
          console.log("keepalive")
        }
      );
      
      if (Api.ws_rpc) {
        resolve("connected");
      }
    });
  };

  const init = () => {
    return new Promise((resolve, reject) => {
      if (Api.ws_rpc) {
        const _on_reconnect = () => {
          console.log("Reconnecting")
          Api.ws_rpc
            .login("", "")
            .then(() => {
              if (currentOptionalApis.enableDatabase && Api._db) {
                Api._db.init().then(() => {
                  if (Api.callbackStatus) {
                    Api.callbackStatus("reconnect");
                  }
                });
              }
              if (currentOptionalApis.enableHistory && Api._hist) {
                Api._hist.init();
              }
              if (currentOptionalApis.enableNetworkBroadcast && Api._net) {
                Api._net.init();
              }
              if (currentOptionalApis.enableOrders && Api._orders) {
                Api._orders.init();
              }
              if (currentOptionalApis.enableCrypto && Api._crypt) {
                Api._crypt.init();
              }
            });
        };

        const _on_close = () => {
          if (Api) {
            close().then(() => {
              if (Api.closeCb) {
                Api.closeCb();
              }
            });
          }
        };

        Api.ws_rpc
          .login("", "")
          .then(() => {
            Api.ws_rpc.on_reconnect = _on_reconnect;
            Api.ws_rpc.on_close = _on_close;

            const initPromises = [];
            if (currentOptionalApis.enableDatabase) {
              // https://dev.bitshares.works/en/latest/api/blockchain_api/database.html
              console.log("Enabled database api")
              try {
                Api._db = new GrapheneApi(Api.ws_rpc, "database");
              } catch (e) {
                console.log({e})
              }
              if (Api._db) {
                const db_promise = Api._db.init().then(() => {
                  return Api._db.exec("get_chain_id", []).then((_chain_id: string) => {
                    Api.chain_id = _chain_id;
                    return ChainConfig.setChainId(_chain_id);
                  });
                });
                initPromises.push(db_promise);
              }
            }

            if (currentOptionalApis.enableHistory) {
              // https://dev.bitshares.works/en/latest/api/blockchain_api/history.html
              console.log("Enabled history api")
              try {
                Api._hist = new GrapheneApi(Api.ws_rpc, "history");
              } catch (e) {
                console.log({e})
              }
              if (Api._hist) {
                initPromises.push(Api._hist.init());
              }
            }

            if (currentOptionalApis.enableNetworkBroadcast) {
              // https://dev.bitshares.works/en/latest/api/blockchain_api/network_broadcast.html
              console.log("Enabled network broadcast api")
              try {
                Api._net = new GrapheneApi(Api.ws_rpc, "network_broadcast");
              } catch (e) {
                console.log({e})
              }
              if (Api._net) {
                initPromises.push(Api._net.init());
              }
            }

            if (currentOptionalApis.enableOrders) {
              // https://dev.bitshares.works/en/latest/api/blockchain_api/new_other.html#orders-api
              console.log("Enabled orders api")
              try {
                Api._orders = new GrapheneApi(Api.ws_rpc, "orders");
              } catch (e) {
                console.log({e})
              }
              if (Api._orders) {
                initPromises.push(Api._orders.init());
              }
            }

            if (currentOptionalApis.enableCrypto) {
              // https://dev.bitshares.works/en/latest/api/blockchain_api/crypto.html
              console.log("Enabled crypto api")
              try {
                Api._crypt = new GrapheneApi(Api.ws_rpc, "crypto");
              } catch (e) {
                console.log({e})
              }
              if (Api._crypt) {
                initPromises.push(Api._crypt.init());
              }
            }
            
            Promise.all(initPromises)
            .then(() => {
              //console.log({Api})
              resolve("initialized");
            })
            .catch((err: Error) => {
              console.log({
                msg: "Failed to initialize with error",
                err
              });
              if (Api) {
                close();
                Api = {};
              }
              reject(err);
            });
          })
          .catch((err: Error) => {
            console.log({
              msg: "Failed to initialize with error",
              err
            });
            if (Api) {
              close();
              Api = {};
            }
          });
      } else {
        reject(new Error("Api not initialized"));
      }
    });
  }
 
  const db_api = () => {
    if (!Api || !Api.ws_rpc) {
      throw new Error("Api not initialized");
    }
    if (Api._db) {
      return Api._db;
    } else {
      throw new Error("Database API disabled by instance config");
    }
  }

  const history_api = () => {
    if (!Api || !Api.ws_rpc) {
      throw new Error("Api not initialized");
    }
    if (Api._hist) {
      return Api._hist;
    } else {
      throw new Error("History API disabled by instance config");
    }
  }

  const network_api = () => {
    if (!Api || !Api.ws_rpc) {
      throw new Error("Api not initialized");
    }
    if (Api._net) {
      return Api._net;
    } else {
      throw new Error("Network API disabled by instance config");
    }
  }

  const crypto_api = () => {
    if (!Api || !Api.ws_rpc) {
      throw new Error("Api not initialized");
    }
    if (Api._crypt) {
      return Api._crypt;
    } else {
      throw new Error("Crypto API disabled by instance config");
    }
  }

  const orders_api = () => {
    if (!Api || !Api.ws_rpc) {
      throw new Error("Api not initialized");
    }
    if (Api._orders) {
      return Api._orders;
    } else {
      throw new Error("Orders API disabled by instance config");
    }
  }

  /*
  const get = (name: string) => new Proxy([], {
    // get("_db")
    get: (_, method) => (...args: any[]) => {
      console.log({_, method})
      if (!Api) {
        throw new Error("Api not initialized");
      }
      if (!Api[name as keyof ApiObject]) {
        console.log({msg: `API ${name} does not exist`, Api, name, comparison: name as keyof ApiObject});
        return null;
      }
      return Api[name as keyof ApiObject].exec(method, [...args]);
    }
  })
  */

  const get = (name: string) =>
  new Proxy([], {
    get: (_, method) => (...args) => Api[name].exec(method, [...args])
  });

  const setRpcConnectionStatusCallback = (callback: any) => (callbackStatus = callback)

  const setAutoReconnect = (auto: boolean) => {
    autoReconnect = auto;
  }

  const chainId = () => {
    if (Api) {
      if (Api.chain_id) {
        return Api.chain_id;
      } else {
        throw new Error("Chain ID not found");
      }
    } else {
      throw new Error("Api not initialized");
    }
  }

  return {
    connect,
    init,
    close,
    db_api,
    network_api,
    history_api,
    crypto_api,
    orders_api,
    get,
    setRpcConnectionStatusCallback,
    setAutoReconnect,
    chainId,
  };
}

/**
 * Close the previous API & initialize a new one
 * @param oldApi The previous api connection
 * @param wssURL The new wss url
 * @param connect 
 * @param connectTimeout 
 * @param optionalApis 
 * @param closeCb 
 * @returns ApiInstance
 */
const reset = (
  oldApi: any = { close: () => {} },
  wssURL: string = "ws://localhost:8090",
  connect: boolean,
  connectTimeout: number = 4000,
  optionalApis: OptionalApis = {
    enableDatabase: false,
    enableHistory: false,
    enableNetworkBroadcast: false,
    enableCrypto: false,
    enableOrders: false
  },
  closeCb?: any
): Promise<ApiInstance> => {
  return oldApi.close().then(() => {
    const Api = newApis();

    if (Api && connect) {
      Api.connect(wssURL, connectTimeout, optionalApis);
    }

    if (closeCb) {
      Api.closeCb = closeCb
    };

    return Api;
  });
};

const instance = (
  wssURL: string = "ws://localhost:8090",
  connect: boolean,
  connectTimeout: number = 4000,
  optionalApis: OptionalApis = {
    enableDatabase: false,
    enableHistory: false,
    enableNetworkBroadcast: false,
    enableCrypto: false,
    enableOrders: false
  },
  closeCb?: any
): Promise<ApiInstance> => {
  
  const Api = newApis();
  if (!Api) {
    throw new Error("Api failed to initialize");
  }

  if (closeCb) {
    Api.closeCb = closeCb;
  }

  return Api.connect(wssURL, connectTimeout, optionalApis).then(() => {
    return Api.init().then(() => {
      console.log("connection initialized")
      return Api;
    });
  });

};

const Apis = {
  reset,
  instance,
}

export default Apis;