import type { PopupType } from "./embed.js";
import { type HYPERLINK_BUILD_ENV_TYPE } from "./interfaces.js";
import { getHyperLinkUrl } from "./utils.js";
import { v4 as uuid } from "uuid";

export enum CallbackType {
  DEFAULT,
  POST,
}
export type WindowCallbacks = {
  [key: string]: {
    type: CallbackType;
    cb: (data: any) => Promise<any>;
  };
};
export type CloseFn = () => void;
export type PostFn = (data: any, publicKeyOverride?: string) => void;

export type WindowOpenParams = {
  popup: Window;
  url: URL;
  windowName: string;
  dimensions: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
};

export class WindowCommunicator {
  private readonly baseUrl: string;
  private publicKey?: string;
  private windowOpenFailHandler: (
    onAlertClick: () => void,
    onAlertClose: () => void,
    popupType: PopupType
  ) => void;

  constructor(
    buildEnv: HYPERLINK_BUILD_ENV_TYPE,
    windowOpenFailHandler: (
      onAlertClick: () => void,
      onAlertClose: () => void,
      popupType: PopupType
    ) => void
  ) {
    this.baseUrl = getHyperLinkUrl(buildEnv);
    this.windowOpenFailHandler = windowOpenFailHandler;
  }

  updatePublicKey(publicKey: string): void {
    this.publicKey = publicKey;
  }

  post = (window: Window, data: any, publicKeyOverride?: string) => {
    window.postMessage(
      {
        ...data,
        publicKey: publicKeyOverride || this.publicKey,
      },
      this.baseUrl
    );
  };

  singlePostToWindow = (window: Window, data: any) => {
    this.post(window, data);
  };

  private setupWindowWithMessages(
    otherWindow: Window,
    windowCallbacks: WindowCallbacks,
    windowName: string,
    endSignals: string[],
    requestId?: string
  ): { post: PostFn; close: CloseFn } {
    const post = this.post.bind(this, otherWindow);

    const endSignalsSet = new Set(endSignals);
    const listener = async (event: {
      origin: string;
      data: { type: string; windowName: string; requestId: string };
    }) => {
      // NOTE: THIS IS IMPERATIVE TO PREVENT MIDDLE MAN ATTACKS. WE ONLY WANT TO ALLOW
      // MESSAGES FROM OUR SITE.
      if (event.origin !== this.baseUrl) {
        // console.log("received unoriginal event", event);
        return;
      }
      if (event.data.windowName !== windowName) {
        // console.log("received event for different window", event);
        return;
      }
      if (requestId && event.data.requestId !== requestId) {
        // console.log("received event for different requestId", event);
        return;
      }
      // console.log("received message", event.data);
      if (!event.data?.type) {
        // console.log("missing type in", event.data);
        return;
      }
      const windowCallback = windowCallbacks[event.data.type];
      if (!windowCallback) {
        // console.log("NO WINDOW CALLBACK", event.data.type);
        return;
      }
      const { type, cb: callback } = windowCallback;
      // console.log("type", type, "callback", callback);
      if (endSignalsSet.has(event.data.type)) {
        window.removeEventListener("message", listener);
      }
      if (callback) {
        switch (type) {
          case CallbackType.DEFAULT:
            void callback(event.data);
            break;
          case CallbackType.POST:
            post(await callback(event.data));
            break;
        }
      }
    };

    window.addEventListener("message", listener);

    return {
      post,
      close: () => {
        window.removeEventListener("message", listener);
      },
    };
  }

  setupHandshakeWithIframe(
    iFrame: HTMLIFrameElement,
    windowCallbacks: WindowCallbacks,
    endSignals: string[],
    requestId?: string
  ): { post: PostFn; close: CloseFn } {
    const windowName = iFrame.name;
    const iframeWindow = iFrame.contentWindow;
    if (!iframeWindow) {
      throw Error("no contentWindow in iFrame provided: " + windowName);
    }
    return this.setupWindowWithMessages(
      iframeWindow,
      windowCallbacks,
      windowName,
      endSignals,
      requestId
    );
  }

  openPopup(path: string): WindowOpenParams {
    const url = new URL(path, this.baseUrl);
    const windowName = uuid();

    const width = 400;
    const height = 600;

    // Calculate the position
    const top = window.top || window;
    const y = top.outerHeight / 2 + top.screenY - height / 2;
    const x = top.outerWidth / 2 + top.screenX - width / 2;
    const popup = window.open(
      url,
      windowName,
      `width=${width}, height=${height}, top=${y}, left=${x}`
    ) as Window;
    return {
      popup,
      url,
      windowName,
      dimensions: {
        x,
        y,
        width,
        height,
      },
    };
  }

  async setupHandshakeWithWindowParams(
    windowOpenParams: WindowOpenParams,
    windowCallbacks: WindowCallbacks,
    endSignals: string[]
  ): Promise<{ post: PostFn; close: CloseFn }> {
    const {
      popup,
      url,
      windowName,
      dimensions: { x, y, width, height },
    } = windowOpenParams;
    return this.setupWindowWithMessages(
      popup,
      windowCallbacks,
      windowName,
      endSignals
    );
  }

  sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
}
