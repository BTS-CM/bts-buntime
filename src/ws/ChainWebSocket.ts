const SOCKET_DEBUG = false;
const MAX_SEND_LIFE = 5;
const MAX_RECV_LIFE = MAX_SEND_LIFE * 2;

class ChainWebSocket {
  public on_close: (() => void) | null = null; // Initialize to null
  public on_reconnect: (() => void) | null;
  public keepAliveCb: ((closed: boolean) => void) | null;
  public ws: WebSocket | null = null; // Initialize to null
  public statusCb: (status: string) => void;

  private url: string;
  private current_reject: ((reason?: any) => void) | null;
  private current_resolve: (() => void) | null = null; // Initialize to null
  private connectionTimeout: any; // Initialize to null
  private keepalive_timer: ReturnType<typeof setInterval> | undefined;
  private closed: boolean;
  private send_life: number;
  private recv_life: number;
  private cbId: number;
  private responseCbId: number;
  private subs: { [key: string]: { callback: (data: any) => void } };
  private unsub: { [key: string]: string };
  private _closeCb: (() => void) | null = null; // Initialize to null
  private connect_promise: Promise<void>;
  private callbacks: {
    [key: number]: ((data: any) => void) | {
      time: Date;
      resolve?: (value?: any) => void;
      reject?: (reason?: any) => void;
    };
  } = {};

  constructor(
    ws_server: string,
    statusCb: (status: string) => void,
    connectTimeout: number = 5000,
    autoReconnect: boolean = true,
    keepAliveCb: ((closed: boolean) => void) | null = null
  ) {
    this.url = ws_server;
    this.statusCb = statusCb;

    this.current_reject = null;
    this.on_reconnect = null;
    this.closed = false;
    this.send_life = MAX_SEND_LIFE;
    this.recv_life = MAX_RECV_LIFE;
    this.keepAliveCb = keepAliveCb;

    this.cbId = 0;
    this.responseCbId = 0;
    this.callbacks = {};
    this.subs = {};
    this.unsub = {};

    this.connect_promise = this.connect(ws_server, connectTimeout);
  }

  /**
   * Called to establish an WSS connection
   * @param {String} server 
   * @param {Number} connectTimeout 
   * @returns 
   */
  private connect = (server: string, connectTimeout: number): Promise<void> =>
    new Promise((resolve, reject) => {
      this.current_reject = reject;
      this.current_resolve = resolve;

      try {
        this.ws = new WebSocket(server);
      } catch (error) {
        this.ws = null;
        console.log({ error, server });
        reject(`Failed to connect to ${server}`);
        return;
      }

      this.ws.addEventListener("open", () => this.onOpen());
      this.ws.addEventListener("error", (event: any) => this.onError(event));
      this.ws.addEventListener("message", (event: any) => this.onMessage(event));
      this.ws.addEventListener("close", () => this.onClose());

      this.connectionTimeout = setTimeout(() => {
        if (this.current_reject) {
          this.current_reject = null;
          this.close();
          reject(
            new Error(
              "Connection attempt timed out after " +
                connectTimeout / 1000 +
                "s"
            )
          );
        }
      }, connectTimeout);
    });

  /**
   * Called when the WSS connection is initialized
   */
  private onOpen = () => {
    clearTimeout(this.connectionTimeout);
    if (this.statusCb) {
      this.statusCb("open")
    };
    if (this.on_reconnect) {
      this.on_reconnect();
    }
    this.keepalive_timer = setInterval(() => {
      this.recv_life--;
      if (this.recv_life == 0) {
        console.error(this.url + " connection is dead, terminating ws");
        this.close();
        return;
      }
      this.send_life--;
      if (this.send_life == 0) {
        if (this.keepAliveCb) {
          this.keepAliveCb(this.closed);
        }
        this.send_life = MAX_SEND_LIFE;
      }
    }, 5000);
    this.current_reject = null;
    if (this.current_resolve) {
      this.current_resolve();
    }
  };

  /**
   * Called when an error is encounrtered with the WSS connection
   * @param {Error} error 
   */
  private onError = (error: Error) => {
    if (this.keepalive_timer) {
      clearInterval(this.keepalive_timer);
      this.keepalive_timer = undefined;
    }
    
    clearTimeout(this.connectionTimeout);
    
    if (this.statusCb) {
      this.statusCb("error");
    }

    if (this.current_reject) {
      this.current_reject(error);
    }
  };

  /**
   * Called when the WSS connection gets data back from a request
   * @param {String} message 
   */
  private onMessage = (message: MessageEvent) => {
    this.recv_life = MAX_RECV_LIFE;
    this.listener(JSON.parse(message.data));
  };

  /**
   * Called when the WSS connection closes
   */
  private onClose = () => {
    this.closed = true;
    if (this.keepalive_timer) {
      clearInterval(this.keepalive_timer);
      this.keepalive_timer = undefined;
    }

    for (var cbId = this.responseCbId + 1; cbId <= this.cbId; cbId += 1) {
      if (typeof this.callbacks[cbId] === 'object' && this.callbacks[cbId] !== null) {
        const callbackObj = this.callbacks[cbId] as { time: Date; resolve?: (value?: any) => void; reject?: (reason?: any) => void };
        if (callbackObj.reject) {
          callbackObj.reject('wss connection closed');
        }
      }
    }

    this.statusCb && this.statusCb("closed");
    this._closeCb && this._closeCb();
    this.on_close && this.on_close();
  };

  /**
   * WSS node login mechanism - use with local nodes
   * @param {Array} params 
   * @returns {Promise}
   */
  public call = (params: any[]): Promise<any> => {
    if (this.ws && this.ws.readyState !== 1) {
      return Promise.reject(
        new Error("websocket state error:" + this.ws.readyState)
      );
    }
    let method = params[1];
    if (SOCKET_DEBUG)
      console.log(
        '[ChainWebSocket] >---- call ----->  "id":' + (this.cbId + 1),
        JSON.stringify(params)
      );

    this.cbId += 1;

    if (
      [
        "set_subscribe_callback",
        "subscribe_to_market",
        "broadcast_transaction_with_callback",
        "set_pending_transaction_callback",
        "set_block_applied_callback"
      ].includes(method)
    ) {
      // Store callback in subs map
      this.subs[this.cbId] = {
        callback: params[2][0]
      };

      // Replace callback with the callback id
      params[2][0] = this.cbId;
    }

    if (
      ["unsubscribe_from_market", "unsubscribe_from_accounts"].includes(method)
    ) {
      if (typeof params[2][0] !== "function") {
        throw new Error(
          "First parameter of unsub must be the original callback"
        );
      }

      let unSubCb = params[2].splice(0, 1)[0];

      // Find the corresponding subscription
      for (let id in this.subs) {
        if (this.subs[id].callback === unSubCb) {
          this.unsub[this.cbId] = id;
          break;
        }
      }
    }

    this.send_life = MAX_SEND_LIFE;

    return new Promise((resolve, reject) => {
      this.callbacks[this.cbId] = {
        time: new Date(),
        resolve: resolve,
        reject: reject
      };

      if (this.ws) {
        this.ws.send(
          JSON.stringify({
            method: "call",
            params: params,
            id: this.cbId
          })
        );
      }
    });
  };

  private listener = (response: any) => {
    if (SOCKET_DEBUG) {
      console.log(
        "[ChainWebSocket] <---- reply ----<",
        JSON.stringify(response)
      );
    }

    let sub = false;
    let callback = null;

    if (response.method === "notice") {
      sub = true;
      response.id = response.params[0];
    }

    if (!sub) {
      const callbackObj = this.callbacks[response.id];
      if (callbackObj) {
        if (response.error) {
          if (typeof callbackObj === "object" && callbackObj.reject) {
            callbackObj.reject(response.error);
          }
        } else {
          if (typeof callbackObj === "object" && callbackObj.resolve) {
            callbackObj.resolve(response.result);
          }
        }
        delete this.callbacks[response.id];
    
        if (this.unsub[response.id]) {
          delete this.subs[this.unsub[response.id]];
          delete this.unsub[response.id];
        }
      }
    } else {
      const subObj = this.subs[response.id];
      if (subObj && typeof subObj.callback === "function") {
        subObj.callback(response.params[1]);
      } else {
        console.log("Warning: callback is not a function");
      }
    }
  };

  /**
   * WSS Account login mechanism
   * @param {String} user 
   * @param {String} password 
   */
  login = (user: string, password: string) => this.connect_promise.then(() => this.call([1, "login", [user, password]]));

  /**
   * Manually closing the WSS connection
   */
  close = (): Promise<void> =>
    new Promise<void>((resolve) => {
      if (this.keepalive_timer) {
        clearInterval(this.keepalive_timer);
        this.keepalive_timer = undefined;
      }

      this._closeCb = () => {
        resolve();
        this._closeCb = null;
      };

      if (!this.ws) {
        console.log("Websocket already cleared", this);
        return resolve();
      }

      if (this.ws.terminate) {
        this.ws.terminate();
      } else {
        this.ws.close();
      }

      if (this.ws.readyState === 3) {
        resolve();
      }
    });
}

export default ChainWebSocket;
