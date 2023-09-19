import ChainWebSocket from "./ChainWebSocket";
import GrapheneApi from "./GrapheneApi";
import ChainConfig from "./ChainConfig";

var autoReconnect = false; // by default don't use reconnecting-websocket
var Api = null;
var callbackStatus = null;

const get = name => new Proxy([], {
  get: (_, method) => (...args) => Api[name].exec(method, [...args])
});

/**
 * Template for initializing a new API instance
 */
const newApis = () => ({
  connect: (
    wssURL,
    connectTimeout,
    optionalApis = { enableCrypto: false, enableOrders: false }
  ) => {
    Api.url = wssURL;
    
    let rpc_user = "";
    let rpc_password = "";

    if (
      typeof window !== "undefined" &&
      window.location &&
      window.location.protocol === "https:" &&
      wssURL.indexOf("wss://") < 0
    ) {
      throw new Error("Secure domains require wss connection");
    }

    if (Api.ws_rpc) {
      Api.ws_rpc.callbackStatus = null;
      Api.ws_rpc.keepAliveCb = null;
      Api.ws_rpc.on_close = null;
      Api.ws_rpc.on_reconnect = null;
    }

    Api.ws_rpc = new ChainWebSocket(
      wssURL,
      Api.callbackStatus,
      connectTimeout,
      autoReconnect,
      closed => {
        if (Api._db && !closed) {
          Api._db.exec("get_objects", [["2.1.0"]]).catch(e => {});
        }
      }
    );

    Api.init_promise = Api.ws_rpc
      .login(rpc_user, rpc_password)
      .then(() => {
        Api._db = new GrapheneApi(Api.ws_rpc, "database");
        Api._net = new GrapheneApi(Api.ws_rpc, "network_broadcast");
        Api._hist = new GrapheneApi(Api.ws_rpc, "history");
        if (optionalApis.enableOrders) {
          Api._orders = new GrapheneApi(Api.ws_rpc, "orders");
        }
        if (optionalApis.enableCrypto) {
          Api._crypt = new GrapheneApi(Api.ws_rpc, "crypto");
        }
        var db_promise = Api._db.init().then(() => {
          return Api._db.exec("get_chain_id", []).then(_chain_id => {
            Api.chain_id = _chain_id;
            return ChainConfig.setChainId(_chain_id);
          });
        });
        Api.ws_rpc.on_reconnect = () => {
          if (!Api.ws_rpc) {
            return;
          }
          Api.ws_rpc.login("", "").then(() => {
            Api._db.init().then(() => {
              if (Api.callbackStatus) {
                Api.callbackStatus("reconnect");
              }
            });
            Api._net.init();
            Api._hist.init();
            if (optionalApis.enableOrders) {
              Api._orders.init();
            }
            if (optionalApis.enableCrypto) {
              Api._crypt.init();
            }
          });
        };
        Api.ws_rpc.on_close = () => {
          Api.close().then(() => {
            if (Api.closeCb) {
              Api.closeCb();
            }
          });
        };
        let initPromises = [db_promise, Api._net.init(), Api._hist.init()];

        if (optionalApis.enableOrders) {
          initPromises.push(Api._orders.init());
        }
        if (optionalApis.enableCrypto) {
          initPromises.push(Api._crypt.init());
        }
        return Promise.all(initPromises);
      })
      .catch(err => {
        console.error(
          wssURL,
          "Failed to initialize with error",
          err && err.message
        );
        return Api.close().then(() => {
          throw err;
        });
      });
  },
  close: async () => {
    if (Api.ws_rpc && Api.ws_rpc.ws.readyState === 1) {
      await Api.ws_rpc.close();
    }

    Api.ws_rpc = null;
  },
  db_api: () => Api._db,
  network_api: () => Api._net,
  history_api: () => Api._hist,
  crypto_api: () => Api._crypt,
  orders_api: () => Api._orders,
  setRpcConnectionStatusCallback: callback => (Api.callbackStatus = callback)
});

const setRpcConnectionStatusCallback = callback => {
  callbackStatus = callback;
  if (Api) {
    Api.setRpcConnectionStatusCallback(callback)
  };
};

const setAutoReconnect = auto => {
  autoReconnect = auto;
};

const reset = (
  wssURL = "ws://localhost:8090",
  connect,
  connectTimeout = 4000,
  optionalApis,
  closeCb
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
  connect,
  connectTimeout = 4000,
  optionalApis,
  closeCb
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
  return instance().chain_id;
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