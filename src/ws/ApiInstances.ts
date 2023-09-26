import ChainWebSocket from "./ChainWebSocket";
import GrapheneApi from "./GrapheneApi";
import ChainConfig from "./ChainConfig";

let autoReconnect = false; // by default don't use reconnecting-websocket
let Api: any = null;
let callbackStatus: any = null;

const get = (name: string) => new Proxy([], {
  get: (_, method) => (...args: any[]) => {
    if (!Api) {
      throw new Error("Api not initialized");
    }
    if (!Api[name]) {
      console.error(`API ${name} does not exist`);
      return null;
    }
    return Api[name].exec(method, [...args]);
  }
});

const keepAliveFunction = (closed: any) => {
  if (Api._db && !closed) {
    Api._db.exec("get_objects", [["2.1.0"]]).catch((e: any) => {});
  }
}

/**
 * Template for initializing a new API instance
 */
const newApis = () => ({
  connect: (
    wssURL: string,
    connectTimeout: number,
    optionalApis: {
      enableDatabase?: boolean,
      enableHistory?: boolean,
      enableNetworkBroadcast?: boolean,
      enableCrypto?: boolean,
      enableOrders?: boolean 
    } = {
      enableDatabase: false,
      enableHistory: false,
      enableNetworkBroadcast: false,
      enableCrypto: false,
      enableOrders: false
    }
  ) => {

    if (!Object.keys(optionalApis).length) {
      // At least one optional Api is required
      throw new Error("Please configure at least one API");
    }

    if (Api.ws_rpc) {
      Api.ws_rpc.callbackStatus = null;
      Api.ws_rpc.keepAliveCb = null;
      Api.ws_rpc.on_close = null;
      Api.ws_rpc.on_reconnect = null;
    }

    Api.url = wssURL;
    Api.ws_rpc = new ChainWebSocket(
      wssURL,
      Api.callbackStatus,
      connectTimeout,
      autoReconnect,
      keepAliveFunction
    );
    

    Api.init_promise = Api.ws_rpc
      .login("", "")
      .then(() => {
        console.log({ optionalApis })
        if (optionalApis.enableDatabase) {
          // https://dev.bitshares.works/en/latest/api/blockchain_api/database.html
          Api._db = new GrapheneApi(Api.ws_rpc, "database");
        }
        if (optionalApis.enableHistory) {
          // https://dev.bitshares.works/en/latest/api/blockchain_api/history.html
          Api._hist = new GrapheneApi(Api.ws_rpc, "history");
        }
        if (optionalApis.enableNetworkBroadcast) {
          // https://dev.bitshares.works/en/latest/api/blockchain_api/network_broadcast.html
          Api._net = new GrapheneApi(Api.ws_rpc, "network_broadcast");
        }
        if (optionalApis.enableOrders) {
          // https://dev.bitshares.works/en/latest/api/blockchain_api/new_other.html#orders-api
          Api._orders = new GrapheneApi(Api.ws_rpc, "orders");
        }
        if (optionalApis.enableCrypto) {
          // https://dev.bitshares.works/en/latest/api/blockchain_api/crypto.html
          Api._crypt = new GrapheneApi(Api.ws_rpc, "crypto");
        }
        
        Api.ws_rpc.on_reconnect = () => {
          if (!Api || !Api.ws_rpc) {
            return;
          }
          Api.ws_rpc
            .login("", "")
            .then(() => {
              if (optionalApis.enableDatabase) {
                Api._db.init().then(() => {
                  if (Api.callbackStatus) {
                    Api.callbackStatus("reconnect");
                  }
                });
              }
              if (optionalApis.enableHistory) {
                Api._hist.init();
              }
              if (optionalApis.enableNetworkBroadcast) {
                Api._net.init();
              }
              if (optionalApis.enableOrders) {
                Api._orders.init();
              }
              if (optionalApis.enableCrypto) {
                Api._crypt.init();
              }
            });
        };

        Api.ws_rpc.on_close = () => {
          if (Api) {
            Api.close().then(() => {
              if (Api.closeCb) {
                Api.closeCb();
              }
            });
          }
        };

        const initPromises = [];

        if (optionalApis.enableDatabase) {
          const db_promise = Api._db.init().then(() => {
            return Api._db.exec("get_chain_id", []).then((_chain_id: string) => {
              Api.chain_id = _chain_id;
              return ChainConfig.setChainId(_chain_id);
            });
          });
          initPromises.push(db_promise);
        }

        if (optionalApis.enableNetworkBroadcast) {
          initPromises.push(Api._net.init());
        }

        if (optionalApis.enableHistory) {
          initPromises.push(Api._hist.init());
        }

        if (optionalApis.enableOrders) {
          initPromises.push(Api._orders.init());
        }

        if (optionalApis.enableCrypto) {
          initPromises.push(Api._crypt.init());
        }

        return Promise.all(initPromises);
      })
      .catch((err: Error) => {
        console.log({
          wssURL,
          msg: "Failed to initialize with error",
          err
        });
        if (Api) {
          Api.close();
          Api = null;
        }
      });
  },
  close: async () => {
    if (
      Api &&
      Api.ws_rpc &&
      Api.ws_rpc.ws && 
      Api.ws_rpc.ws.readyState === 1
    ) {
      await Api.ws_rpc.close();
    }
    Api.ws_rpc = null;
  },
  db_api: () => {
    if (!Api) {
      throw new Error("Api not initialized");
    }
    if (Api._db) {
      return Api._db;
    } else {
      throw new Error("Database API disabled by instance config");
    }
  },
  network_api: () => {
    if (!Api) {
      throw new Error("Api not initialized");
    }
    if (Api._net) {
      return Api._net;
    } else {
      throw new Error("Network API disabled by instance config");
    }
  },
  history_api: () => {
    if (!Api) {
      throw new Error("Api not initialized");
    }
    if (Api._hist) {
      return Api._hist;
    } else {
      throw new Error("History API disabled by instance config");
    }
  },
  crypto_api: () => {
    if (!Api) {
      throw new Error("Api not initialized");
    }
    if (Api._crypt) {
      return Api._crypt;
    } else {
      throw new Error("Crypto API disabled by instance config");
    }
  },
  orders_api: () => {
    if (!Api) {
      throw new Error("Api not initialized");
    }
    if (Api._orders) {
      return Api._orders;
    } else {
      throw new Error("Orders API disabled by instance config");
    }
  },
  setRpcConnectionStatusCallback: (callback: any) => (Api.callbackStatus = callback)
});

const setRpcConnectionStatusCallback = (callback: any) => {
  callbackStatus = callback;
  if (Api) {
    Api.setRpcConnectionStatusCallback(callback)
  };
};

const setAutoReconnect = (auto: boolean) => {
  autoReconnect = auto;
};

const reset = (
  wssURL = "ws://localhost:8090",
  connect: boolean,
  connectTimeout = 4000,
  optionalApis: {
    enableDatabase?: boolean,
    enableHistory?: boolean,
    enableNetworkBroadcast?: boolean,
    enableCrypto?: boolean,
    enableOrders?: boolean 
  } = {
    enableDatabase: false,
    enableHistory: false,
    enableNetworkBroadcast: false,
    enableCrypto: false,
    enableOrders: false
  },
  closeCb?: any
) => {
  return close().then(() => {
    Api = newApis();
    Api.setRpcConnectionStatusCallback(callbackStatus);

    if (Api && connect) {
      Api.connect(wssURL, connectTimeout, optionalApis, closeCb);
    }

    return Api;
  });
};

const instance = (
  wssURL = "ws://localhost:8090",
  connect: boolean,
  connectTimeout = 4000,
  optionalApis: {
    enableDatabase?: boolean,
    enableHistory?: boolean,
    enableNetworkBroadcast?: boolean,
    enableCrypto?: boolean,
    enableOrders?: boolean 
  } = {
    enableDatabase: false,
    enableHistory: false,
    enableNetworkBroadcast: false,
    enableCrypto: false,
    enableOrders: false
  },
  closeCb?: any
) => {
  if (!Api) {
    Api = newApis();
    Api.setRpcConnectionStatusCallback(callbackStatus);
  }

  if (Api && connect) {
    Api.connect(wssURL, connectTimeout, optionalApis);
  }

  if (closeCb) {
    Api.closeCb = closeCb
  };

  return Api;
};

const chainId = () => {
  if (Api) {
    return Api.chain_id;
  }
  throw new Error("Api not initialized");
};

const close = async () => {
  if (Api) {
    await Api.close();
    Api = null;
  }
};

const db = get("_db");
const network = get("_net");
const history = get("_hist");
const crypto = get("_crypt");
const orders = get("_orders");

const Apis = {
  setRpcConnectionStatusCallback,
  setAutoReconnect,
  reset,
  instance,
  chainId,
  close,
  db,
  network,
  history,
  crypto,
  orders,
}

export default Apis;