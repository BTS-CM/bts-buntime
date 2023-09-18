import ChainWebSocket from "./ChainWebSocket";
import GrapheneApi from "./GrapheneApi";
import ChainConfig from "./ChainConfig";

var autoReconnect = false; // by default don't use reconnecting-websocket

var existingApis = null;
var statusCb = null;

const get = (name) => {
  new Proxy([], {
    get: (_, method) => (...args) => existingApis[name].exec(method, [...args])
  });
}

const newApis = () => ({
  connect: (
    cs,
    connectTimeout,
    optionalApis = { enableCrypto: false, enableOrders: false }
  ) => {
    // console.log("INFO\tApiInstances\tconnect\t", cs);
    existingApis.url = cs;
    let rpc_user = "",
      rpc_password = "";
    if (
      typeof window !== "undefined" &&
      window.location &&
      window.location.protocol === "https:" &&
      cs.indexOf("wss://") < 0
    ) {
      throw new Error("Secure domains require wss connection");
    }

    if (existingApis.ws_rpc) {
      existingApis.ws_rpc.statusCb = null;
      existingApis.ws_rpc.keepAliveCb = null;
      existingApis.ws_rpc.on_close = null;
      existingApis.ws_rpc.on_reconnect = null;
    }
    existingApis.ws_rpc = new ChainWebSocket(
      cs,
      existingApis.statusCb,
      connectTimeout,
      autoReconnect,
      closed => {
        if (existingApis._db && !closed) {
          existingApis._db.exec("get_objects", [["2.1.0"]]).catch(e => {});
        }
      }
    );

    existingApis.init_promise = existingApis.ws_rpc
      .login(rpc_user, rpc_password)
      .then(() => {
        existingApis._db = new GrapheneApi(existingApis.ws_rpc, "database");
        existingApis._net = new GrapheneApi(existingApis.ws_rpc, "network_broadcast");
        existingApis._hist = new GrapheneApi(existingApis.ws_rpc, "history");
        if (optionalApis.enableOrders) {
          existingApis._orders = new GrapheneApi(existingApis.ws_rpc, "orders");
        }
        if (optionalApis.enableCrypto) {
          existingApis._crypt = new GrapheneApi(existingApis.ws_rpc, "crypto");
        }
        var db_promise = existingApis._db.init().then(() => {
          return existingApis._db.exec("get_chain_id", []).then(_chain_id => {
            existingApis.chain_id = _chain_id;
            return ChainConfig.setChainId(_chain_id);
          });
        });
        existingApis.ws_rpc.on_reconnect = () => {
          if (!existingApis.ws_rpc) {
            return;
          }
          existingApis.ws_rpc.login("", "").then(() => {
            existingApis._db.init().then(() => {
              if (existingApis.statusCb) {
                existingApis.statusCb("reconnect");
              }
            });
            existingApis._net.init();
            existingApis._hist.init();
            if (optionalApis.enableOrders) {
              existingApis._orders.init();
            }
            if (optionalApis.enableCrypto) {
              existingApis._crypt.init();
            }
          });
        };
        existingApis.ws_rpc.on_close = () => {
          existingApis.close().then(() => {
            if (existingApis.closeCb) {
              existingApis.closeCb();
            }
          });
        };
        let initPromises = [db_promise, existingApis._net.init(), existingApis._hist.init()];

        if (optionalApis.enableOrders) {
          initPromises.push(existingApis._orders.init());
        }
        if (optionalApis.enableCrypto) {
          initPromises.push(existingApis._crypt.init());
        }
        return Promise.all(initPromises);
      })
      .catch(err => {
        console.error(
          cs,
          "Failed to initialize with error",
          err && err.message
        );
        return existingApis.close().then(() => {
          throw err;
        });
      });
  },
  close: async () => {
    if (existingApis.ws_rpc && existingApis.ws_rpc.ws.readyState === 1) {
      await existingApis.ws_rpc.close();
    }

    existingApis.ws_rpc = null;
  },
  db_api: () => existingApis._db,
  network_api: () => existingApis._net,
  history_api: () => existingApis._hist,
  crypto_api: () => existingApis._crypt,
  orders_api: () => existingApis._orders,
  setRpcConnectionStatusCallback: callback => (existingApis.statusCb = callback)
});

const setRpcConnectionStatusCallback = callback => {
  statusCb = callback;
  if (existingApis) {
    existingApis.setRpcConnectionStatusCallback(callback)
  };
};

const setAutoReconnect = auto => {
  autoReconnect = auto;
};

const reset = (
  cs = "ws://localhost:8090",
  connect,
  connectTimeout = 4000,
  optionalApis,
  closeCb
) => {
  return close().then(() => {
    existingApis = newApis();
    existingApis.setRpcConnectionStatusCallback(statusCb);

    if (existingApis && connect) {
      existingApis.connect(cs, connectTimeout, optionalApis, closeCb);
    }

    return existingApis;
  });
};

const instance = (
  cs = "ws://localhost:8090",
  connect,
  connectTimeout = 4000,
  optionalApis,
  closeCb
) => {
  if (!existingApis) {
    existingApis = newApis();
    existingApis.setRpcConnectionStatusCallback(statusCb);
  }

  if (existingApis && connect) {
    existingApis.connect(cs, connectTimeout, optionalApis);
  }

  if (closeCb) {
    existingApis.closeCb = closeCb
  };

  return existingApis;
};

const chainId = () => {
  return instance().chain_id;
};

const close = async () => {
  if (existingApis) {
    await existingApis.close();
    existingApis = null;
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