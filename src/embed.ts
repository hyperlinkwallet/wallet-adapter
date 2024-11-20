/*
This class is accessible as window.hyperLink
*/

import type {
  Connection,
  SendOptions,
  TransactionSignature,
} from "@solana/web3.js";
import { VersionedTransaction } from "@solana/web3.js";
import { PublicKey } from "@solana/web3.js";
import type {
  SendTransactionOptions,
  TransactionOrVersionedTransaction,
  WalletAdapterNetwork,
} from "@solana/wallet-adapter-base";
import { Transaction } from "@solana/web3.js";
import { documentReady, htmlToElement } from "./embedUtils";
import type { HYPERLINK_BUILD_ENV_TYPE } from "./interfaces";

import {
  checkAndAttachHyperLinkInstance,
  getCloseButtonUrl,
  getHyperLinkUrl,
  iFrameUrl,
  isElement,
  removePreviousWindowRef,
  HyperLinkInstanceKey,
} from "./utils";
import type {
  CloseFn,
  PostFn,
  WindowCallbacks,
  WindowOpenParams,
} from "./window";
import { CallbackType, WindowCommunicator } from "./window";
import {
  EventEmitter,
  WalletSendTransactionError,
  WalletSignTransactionError,
  isVersionedTransaction,
} from "@solana/wallet-adapter-base";
import type {
  SolanaSignInInput,
  SolanaSignInOutput,
} from "@solana/wallet-standard-features";
import {
  SolanaSignAndSendTransaction,
  SolanaSignTransaction,
  SolanaSignMessage,
  SolanaSignIn,
} from "@solana/wallet-standard-features";
import {
  createSignInMessage,
  type SolanaSignInInputWithRequiredFields,
} from "@solana/wallet-standard-util";
import { v4 as uuid } from "uuid";
import type { CustomSolanaSignInInput } from "./index.js";
import {
  NPM_VERSION,
  type HyperLinkWalletAdapterTheme,
  EmbeddedWalletPage,
} from "./index.js";
import { SOLANA_MAINNET_CHAIN } from "@solana/wallet-standard-chains";
import { ReadonlyWalletAccount } from "@wallet-standard/wallet";
import { showDialog } from "./dialog.js";
import interact from "interactjs";
import { Buffer } from "buffer";

export interface HyperLinkEmbedEvents {
  connect(...args: unknown[]): unknown;
  disconnect(...args: unknown[]): unknown;
  accountChanged(...args: unknown[]): unknown;
  accountChanged(newPublicKeyString: string): unknown;
}

export enum PopupType {
  MESSAGE,
  TRANSACTION,
  LOGIN,
  NOT_ALLOWLISTED,
}

const EDGE_OFFSET = 20;
const EXPAND_THRESHOLD = 20;
const MOBILE_BREAKPOINT = 476;
const WIDGET_ID_PREFIX = "tiplink-widget-draggable";
const IFRAME_ID_PREFIX = "hyperLinkIframe";
const WIDGET_DIMENSION = {
  HEIGHT: {
    COLLAPSED: 54,
    MOBILE: 54,
    DESKTOP: 72,
  },
  WIDTH: {
    COLLAPSED: 20,
    MOBILE: 77,
    DESKTOP: 101,
  },
};

function widgetId(id: string) {
  return `${WIDGET_ID_PREFIX}-${id}`;
}

function iframeId(id: string) {
  return `${IFRAME_ID_PREFIX}-${id}`;
}

function preventDefaultScroll(event: TouchEvent | Event) {
  event.preventDefault();
}

function bottom() {
  return window.innerHeight;
}

function right() {
  return window.innerWidth;
}

function isMobileDimension() {
  return right() <= MOBILE_BREAKPOINT;
}

function getStableWidgetHeight(isCollapsedUi?: boolean) {
  if (isCollapsedUi) {
    return WIDGET_DIMENSION.HEIGHT.COLLAPSED;
  }
  return isMobileDimension()
    ? WIDGET_DIMENSION.HEIGHT.MOBILE
    : WIDGET_DIMENSION.HEIGHT.DESKTOP;
}

function getStableWidgetWidth(isCollapsedUi?: boolean) {
  if (isCollapsedUi) {
    return WIDGET_DIMENSION.WIDTH.COLLAPSED;
  }
  return isMobileDimension()
    ? WIDGET_DIMENSION.WIDTH.MOBILE
    : WIDGET_DIMENSION.WIDTH.DESKTOP;
}

function getEdgetOffset(
  isOnLeftSide: boolean,
  isCollapsedUi: boolean,
  widgetWidth: number
) {
  if (isOnLeftSide) {
    return isCollapsedUi ? 0 : EDGE_OFFSET;
  }
  return isCollapsedUi ? widgetWidth : widgetWidth + EDGE_OFFSET;
}

function getWidgetUIMetadata(widget: HTMLDivElement, x: number) {
  const vw = right();
  const vh = bottom();
  const isOnLeftSide = x < (vw - EDGE_OFFSET) / 2;
  const isCollapsedUi = widget.classList.contains("hyperLinkWidget_collapsed");
  const widgetWidth = getStableWidgetWidth(isCollapsedUi);
  const widgetHeight = getStableWidgetHeight(isCollapsedUi);
  const offset = getEdgetOffset(isOnLeftSide, isCollapsedUi, widgetWidth);
  return {
    vw,
    vh,
    offset,
    widgetHeight,
    widgetWidth,
  };
}

function getWidgetAttributes(widget: HTMLDivElement) {
  const vh = bottom();
  const dataXAttr = widget.getAttribute("data-x");
  const dataYAttr = widget.getAttribute("data-y");
  const dataWinYAttr = widget.getAttribute("data-vh");
  const dataPrevXAttr = widget.getAttribute("data-x-prev");
  const parsedPrevX = dataPrevXAttr ? parseFloat(dataPrevXAttr) : 0;
  const parsedX = dataXAttr ? parseFloat(dataXAttr) : 0;
  const parsedY = dataYAttr ? parseFloat(dataYAttr) : 0;
  const parsedVh = dataWinYAttr ? parseFloat(dataWinYAttr) : vh;
  return {
    parsedX,
    parsedY,
    parsedVh,
    parsedPrevX,
  };
}

function updateWidgetPosStyleAndAttributes(
  widget: HTMLDivElement,
  x: number,
  y: number
) {
  widget.style.transform = `translate(${x}px, ${y}px)`;
  widget.setAttribute("data-x", x + "");
  widget.setAttribute("data-y", y + "");
  widget.setAttribute("data-vh", bottom() + "");
}

function isBottomCornerPosition(y: number, vh: number, widget: HTMLDivElement) {
  const isCollapsedUi = widget.classList.contains("hyperLinkWidget_collapsed");
  const widgetHeight = getStableWidgetHeight(isCollapsedUi);
  const maxY = vh - widgetHeight - EDGE_OFFSET;
  const bottomBuffer = EDGE_OFFSET; // additional range
  return Math.abs(maxY - y) <= bottomBuffer;
}

function stickToNearestCorner(
  x: number,
  y: number,
  widget: HTMLDivElement
): { x: number; y: number } {
  const { vw, vh, offset, widgetHeight } = getWidgetUIMetadata(widget, x);
  const stickyX = x < (vw - EDGE_OFFSET) / 2 ? offset : vw - offset;
  const stickyY =
    y < (vh - EDGE_OFFSET) / 2 ? EDGE_OFFSET : vh - widgetHeight - EDGE_OFFSET;
  return {
    x: stickyX,
    y: stickyY,
  };
}

function stickToNearestSideEdge(
  x: number,
  y: number,
  widget: HTMLDivElement
): { x: number; y: number } {
  const { vw, vh, offset, widgetHeight } = getWidgetUIMetadata(widget, x);
  const nearestSideX = x < (vw - EDGE_OFFSET) / 2 ? offset : vw - offset;
  const boundaryY =
    y < (vh - EDGE_OFFSET) / 2
      ? Math.max(EDGE_OFFSET, y)
      : Math.min(vh - widgetHeight - EDGE_OFFSET, y);
  widget.setAttribute("data-vh", vh + "");
  return {
    x: nearestSideX,
    y: boundaryY,
  };
}

function showExpandedWalletWidget(
  widgetElement: HTMLDivElement,
  theme?: string
) {
  const widgetLogo = document?.getElementById("tiplink-widget-logo");
  const widgetLabel = document?.getElementById("tiplink-widget-text");
  const widgetChevron = document?.getElementById("tiplink-widget-chevron");
  const widgetNotif = document?.getElementById("tiplink-widget-notif");
  if (widgetLogo) {
    widgetLogo.style.display = "block";
  }
  if (widgetLabel) {
    widgetLabel.style.display = "block";
  }
  if (widgetChevron) {
    widgetChevron.style.display = "none";
  }
  if (
    widgetNotif &&
    widgetNotif.classList.contains("tiplinkWidget_notif_show")
  ) {
    widgetNotif.style.removeProperty("left");
    widgetNotif.style.setProperty("right", "-4px");
  }

  updateWalletWidgetClassNames(widgetElement, theme, false);
}

function showCollapsedWalletWidget(
  widgetElement: HTMLDivElement,
  theme?: string,
  isOnLeftSide?: boolean
) {
  // don't collapse on desktop dimension right-side
  const vw = right();
  if (vw > 476 && !isOnLeftSide) return;
  const widgetLogo = document?.getElementById("tiplink-widget-logo");
  const widgetLabel = document?.getElementById("tiplink-widget-text");
  const widgetChevron = document?.getElementById("tiplink-widget-chevron");
  const widgetNotif = document?.getElementById("tiplink-widget-notif");
  if (widgetLogo) {
    widgetLogo.style.display = "none";
  }
  if (widgetLabel) {
    widgetLabel.style.display = "none";
  }
  if (widgetChevron) {
    widgetChevron.style.display = "block";
    widgetChevron.style.transform = isOnLeftSide
      ? "rotate(0)"
      : "rotate(180deg)";
  }
  if (
    widgetNotif &&
    widgetNotif.classList.contains("tiplinkWidget_notif_show") &&
    !isOnLeftSide
  ) {
    widgetNotif.style.removeProperty("right");
    widgetNotif.style.setProperty("left", "-4px");
  }

  updateWalletWidgetClassNames(widgetElement, theme, true, isOnLeftSide);
}

function setupTouchIntercept() {
  document.body.addEventListener("touchmove", preventDefaultScroll, {
    passive: false,
  });
  window.addEventListener("scroll", preventDefaultScroll, {
    passive: false,
  });
  document.body.style.touchAction = "none";
}

function teardownTouchIntercept() {
  document.body.removeEventListener("touchmove", preventDefaultScroll);
  window.removeEventListener("scroll", preventDefaultScroll);
  document.body.style.touchAction = "";
}

function setupWalletWidgetClassNames(
  theme?: string, // Explicitly define allowed theme values
  isCollapsed?: boolean,
  isLeftSide?: boolean,
  isOnMount?: boolean
) {
  const classNames: string[] = [];

  if (isCollapsed) {
    classNames.push(
      "hyperLinkWidget_collapsed",
      isLeftSide
        ? "hyperLinkWidget_collapsed_left"
        : "hyperLinkWidget_collapsed_right"
    );
  } else {
    classNames.push("hyperLinkWidget_expanded");
  }

  if (isOnMount) {
    classNames.push("hyperLinkWidget_enter");
  }

  switch (theme) {
    case "dark":
      classNames.push("hyperLinkWidget_dark");
      break;
    case "light":
      classNames.push("hyperLinkWidget_light");
      break;
    case "system":
    default:
      classNames.push("tiplinkWidget_system");
  }
  return classNames.join(" ");
}

function updateWalletWidgetClassNames(
  widgetElement: HTMLDivElement,
  theme?: string,
  isCollapsed?: boolean,
  isOnLeftSide?: boolean
) {
  const className = setupWalletWidgetClassNames(
    theme,
    isCollapsed,
    isOnLeftSide
  );
  widgetElement.setAttribute("class", className);
}

function setupWalletWidgetIconSvg() {
  return `<svg height="100%" viewBox="0 0 17 24" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M1.60322 1.30318C-0.134339 3.04074 -0.134339 5.8579 1.60322 7.59547L5.24972 11.242L6.50817 9.98353L2.86167 6.33701C1.81914 5.29447 1.81914 3.60418 2.86167 2.56163C3.90421 1.51909 5.59449 1.51909 6.63702 2.56163L14.1877 10.1124C15.2303 11.1549 15.2303 12.8452 14.1877 13.8878C13.1452 14.9303 11.4549 14.9303 10.4124 13.8878L9.26542 12.7408L8.00697 13.9993L9.15393 15.1462C10.8915 16.8838 13.7086 16.8838 15.4462 15.1462C17.1837 13.4086 17.1837 10.5915 15.4462 8.85393L7.89548 1.30318C6.15792 -0.434392 3.34078 -0.434392 1.60322 1.30318Z" fill="currentColor"/>
  <path d="M6.0078 12.0001L1.60322 16.4047C-0.134341 18.1423 -0.134341 20.9594 1.60322 22.697C3.34078 24.4345 6.15792 24.4345 7.89547 22.697L12.9322 17.6602C12.1615 17.7458 11.3767 17.6744 10.6296 17.4459L6.63702 21.4385C5.59449 22.4811 3.9042 22.4811 2.86167 21.4385C1.81913 20.396 1.81913 18.7057 2.86167 17.6631L10.4124 10.1124C10.7825 9.74226 11.2343 9.50353 11.7097 9.39621L10.3252 8.01169C9.90244 8.22109 9.50602 8.50184 9.15393 8.85393L7.26625 10.7416L7.26325 10.7386L6.0048 11.9971L6.0078 12.0001Z" fill="currentColor"/>
  </svg>
  `;
}

function handleMouseEnter(e: MouseEvent) {
  const widget = e.target;
  if (!widget) return;
  (widget as HTMLDivElement).style.background = "rgba(0, 124, 191, 0.10)";
}

function handleMouseLeave(e: MouseEvent) {
  const widget = e.target;
  if (!widget) return;
  (widget as HTMLDivElement).style.background = "rgba(255, 255, 255, 0.70)";
}

function applyStretchStyleProperties(
  widget: HTMLDivElement,
  xDelta: number,
  isOnLeftSide: boolean
) {
  widget.style.setProperty("width", `${20 + xDelta}px`, "important");
  widget.style.setProperty("justify-content", isOnLeftSide ? "end" : "start");
  widget.style.setProperty(
    isOnLeftSide ? "padding-right" : "padding-left",
    "6px"
  );
  widget.style.setProperty("transition", "none");
}

function removeAddedProperties(widget: HTMLDivElement) {
  widget.style.removeProperty("width");
  widget.style.removeProperty("justify-content");
  widget.style.removeProperty("padding-left");
  widget.style.removeProperty("padding-right");
  widget.style.removeProperty("transition");
}

function expandWalletWidgetOnClick(widget: HTMLDivElement, theme?: string) {
  showExpandedWalletWidget(widget as HTMLDivElement, theme);
  const parsedX =
    parseFloat((widget as HTMLDivElement).getAttribute("data-x") || "0") || 0;
  const parsedY =
    parseFloat((widget as HTMLDivElement).getAttribute("data-y") || "0") || 0;
  const { x, y } = stickToNearestSideEdge(parsedX, parsedY, widget);
  // Apply the adjusted positions
  widget.style.transform = `translate(${x}px, ${y}px)`;
  widget.setAttribute("data-x", String(x));
  widget.setAttribute("data-y", String(y));
  removeAddedProperties(widget);
}

function setupWalletWidget({
  onDragStart,
  onDragEnd,
  isDragging,
  setInteractable,
  handleWidgetClick,
  windowDraggableResizeListener,
  windowDraggableScrollListener,
  hyperLinkSessionId,
  theme,
  onSwipeLeft,
}: {
  onDragStart: () => void;
  onDragEnd: () => void;
  isDragging: () => boolean;
  setInteractable: (interactable: Interact.Interactable) => void;
  handleWidgetClick: () => void;
  windowDraggableResizeListener: () => void;
  windowDraggableScrollListener: () => void;
  hyperLinkSessionId: string;
  theme?: string;
  onSwipeLeft?: () => void;
}): Element | undefined {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return;
  }
  const widgetClassNames = setupWalletWidgetClassNames(
    theme,
    false,
    true,
    true
  );
  const widgetIconSvg = setupWalletWidgetIconSvg();
  const vh = bottom();
  const initialYOffset = isMobileDimension()
    ? WIDGET_DIMENSION.HEIGHT.MOBILE + EDGE_OFFSET + 20 // init mobile a little higher
    : WIDGET_DIMENSION.HEIGHT.DESKTOP + EDGE_OFFSET;
  const initialWidgetYPosition = vh - initialYOffset;
  const widgetElementId = widgetId(hyperLinkSessionId);
  console.log("widgetClassNames", widgetClassNames);
  const htmlString = `
      <div id="${widgetElementId}" class="${widgetClassNames}" style="transform: translate(20px, calc(100svh - ${initialYOffset}px)); pointer-events: auto; touch-action: none; -ms-touch-action: none" data-x="20" data-y="${initialWidgetYPosition}" data-x-prev="20" data-vh="${vh}" >
        <div class="tiplinkWidget_pulse"></div>
        <div id="tiplink-widget-notif" style="user-selection: none; height: 0px; width: 0px; overflow: hidden;">1</div>
        <div id="tiplink-widget-logo" style="width: auto; height: 32px; margin-bottom: 4px;">
          ${widgetIconSvg}
        </div>
        <p id="tiplink-widget-text">View Wallet</p>
        <div id="tiplink-widget-chevron" style="display: none;">
          <svg width="8" height="12" viewBox="0 0 8 12" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path fill-rule="evenodd" clip-rule="evenodd" d="M0.910746 0.410826C1.23618 0.0853888 1.76382 0.0853888 2.08926 0.410826L7.08926 5.41083C7.41469 5.73626 7.41469 6.2639 7.08926 6.58934L2.08926 11.5893C1.76382 11.9148 1.23618 11.9148 0.910746 11.5893C0.585309 11.2639 0.585309 10.7363 0.910746 10.4108L5.32149 6.00008L0.910746 1.58934C0.585309 1.2639 0.585309 0.736263 0.910746 0.410826Z" fill="currentColor" />
          </svg>          
        </div>
      </div>
    `;
  const buttonDiv = htmlToElement(htmlString);
  buttonDiv.addEventListener("click", (e) => {
    if (isDragging()) {
      return;
    }
    const widget = document.getElementById(widgetElementId) as HTMLDivElement;
    const isCollapsed = (widget as HTMLDivElement).classList.contains(
      "hyperLinkWidget_collapsed"
    );
    if (isCollapsed) {
      expandWalletWidgetOnClick(widget, theme);
    } else {
      handleWidgetClick();
    }
  });
  buttonDiv.addEventListener("mousedown", setupTouchIntercept);
  buttonDiv.addEventListener("touchstart", setupTouchIntercept);
  buttonDiv.addEventListener("mouseup", teardownTouchIntercept);
  buttonDiv.addEventListener("touchend", teardownTouchIntercept);
  buttonDiv.addEventListener("touchforcechange", (event: Event) => {
    event.preventDefault();
  });
  window.document.body.appendChild(buttonDiv);
  const interactable = interact(`#${widgetElementId}`).draggable({
    listeners: {
      start() {
        setupTouchIntercept();
      },
      end() {
        teardownTouchIntercept();
      },
    },
    cursorChecker: () => "pointer",
    modifiers: [
      interact.modifiers.snap({
        targets: [
          function (x, y) {
            const widget = document.getElementById(widgetElementId);
            const { x: stickyX, y: stickyY } = stickToNearestSideEdge(
              x,
              y - window.scrollY,
              widget as HTMLDivElement
            );
            return {
              x: stickyX,
              y: stickyY + window.scrollY,
            };
          },
        ],
        range: Infinity,
        relativePoints: [{ x: 0, y: 0 }],
        endOnly: true,
      }),
    ],
    inertia: true,
    onstart: (event: { target: HTMLDivElement }) => {
      const target = event.target;
      const originX = parseFloat(target.getAttribute("data-x") || "0") || 0;
      target.setAttribute("data-x-prev", String(originX));
      setupTouchIntercept();
      onDragStart();
    },
    onmove: function (event: { target: any; dx: any; dy: any }) {
      onDragStart();
      const target = event.target;
      const isCollapsed = target.classList.contains(
        "hyperLinkWidget_collapsed"
      );
      const x = (parseFloat(target.getAttribute("data-x")) || 0) + event.dx;
      const y = (parseFloat(target.getAttribute("data-y")) || 0) + event.dy;
      const vw = right();
      const widgetWidth = getStableWidgetWidth(isCollapsed);
      const isOutOfBoundX =
        x <= (widgetWidth / 2) * -1 || x >= vw - EDGE_OFFSET - EXPAND_THRESHOLD;
      const isOnLeftSide = x < (vw - EDGE_OFFSET) / 2;
      const xDelta = isOnLeftSide ? x : vw - x - EDGE_OFFSET;
      const shouldExpand = isMobileDimension()
        ? xDelta >=
          WIDGET_DIMENSION.WIDTH.MOBILE - EDGE_OFFSET - EXPAND_THRESHOLD
        : xDelta >=
          WIDGET_DIMENSION.WIDTH.DESKTOP - EDGE_OFFSET - EXPAND_THRESHOLD;
      const shouldCollapse = !isCollapsed && isOutOfBoundX;
      const isStickiedToLeftEdge =
        isCollapsed && isOnLeftSide && (xDelta > 0 || xDelta < 0);
      if (isCollapsed) {
        if (xDelta > 0) {
          applyStretchStyleProperties(target, xDelta, isOnLeftSide);
        } else {
          removeAddedProperties(target);
        }
        if (shouldExpand) {
          showExpandedWalletWidget(target, theme);
          removeAddedProperties(target);
        }
      }
      if (shouldCollapse) {
        showCollapsedWalletWidget(target, theme, isOnLeftSide);
      }
      target.style.transform = `translate(${
        isStickiedToLeftEdge ? 0 : x
      }px, ${y}px)`;
      target.setAttribute("data-x", x);
      target.setAttribute("data-y", y);
    },
    onend: (event: {
      target: any;
      duration: number;
      x0: number;
      y0: number;
      swipe: {
        angle: number;
        down: boolean;
        left: boolean;
        right: boolean;
        speed: number;
        up: boolean;
        velocity: {
          x: number;
          y: number;
        };
      } | null;
    }) => {
      const target = event.target;
      const { parsedX, parsedY } = getWidgetAttributes(target);
      const { x, y } = stickToNearestSideEdge(parsedX, parsedY, target);
      updateWidgetPosStyleAndAttributes(target, x, y);
      onDragEnd();
      teardownTouchIntercept();
    },
  });
  setInteractable(interactable);
  // This is used later to position the element at load time
  window.addEventListener("resize", windowDraggableResizeListener);
  window.addEventListener("scroll", windowDraggableScrollListener);
  return buttonDiv;
}

function tearDownWalletWidget(
  windowResizeListener: () => void,
  windowScrollListener: () => void,
  interactable?: Interact.Interactable,
  target?: Element
) {
  window.removeEventListener("resize", windowResizeListener);
  window.removeEventListener("scroll", windowScrollListener);
  if (target) {
    target.remove();
  }
  interactable?.unset();
}

export class HyperLinkEmbed extends EventEmitter<HyperLinkEmbedEvents> {
  publicKeyString: string | undefined;

  private hyperLinkAlertContainer: HTMLDivElement | undefined;
  private hyperLinkToastContainer: HTMLDivElement | undefined;

  private hyperLinkIframe: HTMLIFrameElement | undefined;
  private hyperLinkDraggableWidget: Element | undefined;
  private draggableWidgetWindowResizeListener: () => void;
  private draggableWidgetWindowScrollListener: () => void;
  private readonly buildEnv: HYPERLINK_BUILD_ENV_TYPE;

  private windowCommunicator: WindowCommunicator;
  private styleLink: HTMLLinkElement | undefined;
  private title: string;
  private readonly clientId: string;
  private readonly isDisallowed: () => boolean;
  private readonly forceIframe: boolean;
  private _isDragging = false;
  private _interactable: Interact.Interactable | undefined;
  theme: string | undefined;
  private readonly hyperLinkSessionId: string;
  private readonly dAppSessionId: string;
  private _walletHandshake:
    | {
        post: PostFn;
        close: CloseFn;
      }
    | undefined;
  private _walletAdapterNetwork:
    | WalletAdapterNetwork.Mainnet
    | WalletAdapterNetwork.Devnet;

  constructor(
    title: string,
    buildEnv: HYPERLINK_BUILD_ENV_TYPE,
    clientId: string,
    forceIframe: boolean,
    dAppSessionId: string,
    walletAdapterNetwork:
      | WalletAdapterNetwork.Mainnet
      | WalletAdapterNetwork.Devnet,
    isDisallowed: () => boolean
  ) {
    super();
    this.title = title;
    this.hyperLinkAlertContainer = undefined;
    this.hyperLinkToastContainer = undefined;
    const prevPublicKey = localStorage.getItem("hyperLink_pk_connected");
    this.publicKeyString = prevPublicKey || undefined;
    this.buildEnv = buildEnv;
    this.clientId = clientId;
    this.windowCommunicator = new WindowCommunicator(
      this.buildEnv,
      (onClick: () => void, onClose: () => void, popupType: PopupType) => {
        this._createPopupBlockAlert(onClick, onClose, popupType);
      }
    );
    const cssLink = new URL("/css/widget.css", getHyperLinkUrl(this.buildEnv));
    this.styleLink = htmlToElement<HTMLLinkElement>(
      `<link href="${cssLink.toString()}" rel="stylesheet" type="text/css">`
    );
    this.forceIframe = forceIframe;
    this.isDisallowed = isDisallowed;
    this.dAppSessionId = dAppSessionId;
    this.hyperLinkSessionId = uuid();
    this._walletAdapterNetwork = walletAdapterNetwork;
    this.draggableWidgetWindowResizeListener = () => {
      if (this._isDragging || !this.hyperLinkDraggableWidget) return;
      const target = this.hyperLinkDraggableWidget as HTMLDivElement;
      const { parsedX, parsedY, parsedVh } = getWidgetAttributes(target);
      let finalX = 0,
        finalY = 0;
      // translate corner position if window resize
      if (isBottomCornerPosition(parsedY, parsedVh, target)) {
        const { x, y } = stickToNearestCorner(
          parsedX,
          parsedY,
          target as HTMLDivElement
        );
        finalX = x;
        finalY = y;
      } else {
        // stick to edge on horizontal window resize
        const { x, y } = stickToNearestSideEdge(
          parsedX,
          parsedY,
          target as HTMLDivElement
        );
        finalX = x;
        finalY = y;
      }
      updateWidgetPosStyleAndAttributes(target, finalX, finalY);
    };
    this.draggableWidgetWindowScrollListener = () => {
      if (this._isDragging || !this.hyperLinkDraggableWidget) return;
      const target = this.hyperLinkDraggableWidget as HTMLDivElement;
      const { parsedX, parsedY, parsedVh } = getWidgetAttributes(target);
      if (!isBottomCornerPosition(parsedY, parsedVh, target)) return;
      const { x, y } = stickToNearestCorner(
        parsedX,
        parsedY,
        target as HTMLDivElement
      );
      // Update transform and attributes
      updateWidgetPosStyleAndAttributes(target, x, y);
    };
    checkAndAttachHyperLinkInstance(this);
  }

  get publicKey(): PublicKey | null {
    if (this.publicKeyString) {
      return new PublicKey(this.publicKeyString);
    }
    return null;
  }

  get isLoggedIn(): boolean {
    return !!this.publicKeyString;
  }

  private extendSession = () => {
    if (!this.hyperLinkIframe?.contentWindow) {
      return;
    }
    this.windowCommunicator.singlePostToWindow(
      this.hyperLinkIframe.contentWindow,
      {
        message: "extend_session",
      }
    );
  };

  private hideIframe() {
    if (this.hyperLinkIframe?.style?.display) {
      this.hyperLinkIframe.style.display = "none";
    }
  }

  private showWidgetNotificationUi() {
    if (!document) return;
    const notif = document.getElementById("tiplink-widget-notif");
    notif?.classList.add("tiplinkWidget_notif_show");
  }

  private hideWidgetNotificationUi() {
    if (!document) return;
    const notif = document.getElementById("tiplink-widget-notif");
    notif?.classList.remove("tiplinkWidget_notif_show");
  }

  private getGreenCheckmarkLogoUrl(): string {
    return new URL(
      "adapter-green-checkmark.svg",
      getHyperLinkUrl(this.buildEnv)
    ).toString();
  }

  private getHyperLinkLogoUrl(): string {
    const logoUrl = new URL(
      "adapter-tiplink-logo.svg",
      getHyperLinkUrl(this.buildEnv)
    );
    return logoUrl.toString();
  }

  private getWhiteHyperLinkLogoUrl(): string {
    const logoUrl = new URL(
      "brand-assets/logo/logomark/svg/tiplink_logomark_white.svg",
      getHyperLinkUrl(this.buildEnv)
    );
    return logoUrl.toString();
  }

  private getDarkHyperLinkLogoUrl(): string {
    const logoUrl = new URL(
      "tiplink/tiplink-logo-dark.svg",
      getHyperLinkUrl(this.buildEnv)
    );
    return logoUrl.toString();
  }

  private getGoogleLogoUrl(): string {
    const logoUrl = new URL(
      "adapter-google-logo.svg",
      getHyperLinkUrl(this.buildEnv)
    );
    return logoUrl.toString();
  }

  private getBackgroundImageUrl(): string {
    const logoUrl = new URL(
      "adapter-modal-background.png",
      getHyperLinkUrl(this.buildEnv)
    );
    return logoUrl.toString();
  }

  private popupTypeMessage = (popupType: PopupType) => {
    const baseUrl = getHyperLinkUrl(this.buildEnv);
    switch (popupType) {
      case PopupType.MESSAGE:
        return {
          title: "Click below to view message:",
          description: "",
          popupImgUrl: new URL("adapter-message.svg", baseUrl).toString(),
          buttonText: "View Message",
        };
      case PopupType.TRANSACTION:
        return {
          title: "View Transaction",
          description: "Click below to view and confirm your transaction:",
          popupImgUrl: new URL("adapter-wallet.svg", baseUrl).toString(),
          buttonText: "View Transaction",
        };
      case PopupType.LOGIN:
        return {
          title: "Login",
          description: "Click below to login:",
          popupImgUrl: new URL("adapter-wallet.svg", baseUrl).toString(),
          buttonText: "Login",
        };
      case PopupType.NOT_ALLOWLISTED:
        return {
          title: "Application not allowlisted",
          description:
            "Your application has not been allowlisted for the HyperLink Wallet Adapter. Please reach out to contact@tiplink.io for support",
        };
    }
  };

  private fadeIn(element: HTMLDivElement) {
    element.classList.remove("fade-out");
    element.classList.add("fade-in");
    element.style.display = "flex";
  }

  private fadeOut(element: HTMLDivElement, onFinished: () => void) {
    element.classList.remove("fade-in");
    element.classList.add("fade-out");
    const listener = (event: any) => {
      if (event.animationName === "fadeOut") {
        element.style.display = "none"; // Set display to none after fade-out
        element.removeEventListener("animationend", listener);
        onFinished();
      }
    };
    element.addEventListener("animationend", listener);
  }

  private _showSuccessToast(text: string): void {
    const innerContainer = htmlToElement<HTMLDivElement>(
      `<div id='hyperLinkSuccessToast__inner_container'>
        <img id="hyperLinkSuccessCheckmark__logo" src="${this.getGreenCheckmarkLogoUrl()}" />
        <p>${text}</p>
      </div>`
    );
    const removeToast = (element?: HTMLDivElement) => {
      if (element) {
        element.remove();
        if (
          this.hyperLinkToastContainer &&
          this.hyperLinkToastContainer.children.length === 0
        ) {
          this.hyperLinkToastContainer.style.display = "none";
        }
      }
    };
    const attachOnLoad = () => {
      if (this.hyperLinkToastContainer) {
        innerContainer.addEventListener("click", () => {
          removeToast(innerContainer);
        });
        this.hyperLinkToastContainer.appendChild(innerContainer);
      }
    };
    attachOnLoad();
    if (this.hyperLinkToastContainer) {
      this.hyperLinkToastContainer.style.display = "block";
      this.fadeIn(innerContainer);
      setTimeout(() => {
        if (innerContainer) {
          this.fadeOut(innerContainer, () => {
            removeToast(innerContainer);
          });
        }
      }, 10_000);
    }
  }

  private showHyperLinkAutoconnectToast = () => {
    this._showSuccessToast("Your HyperLink wallet is connected!");
  };

  private async _createPopupBlockAlert(
    onClick: () => void,
    onClose: () => void,
    popupType: PopupType
  ): Promise<void> {
    const modal = htmlToElement<HTMLDivElement>(
      "<div id='hyperLinkAlertModal'></div>"
    );
    const innerContainer = htmlToElement<HTMLDivElement>(
      "<div id='hyperLinkAlert__inner_container'></div>"
    );
    const overlay = htmlToElement<HTMLDivElement>(
      "<div id='hyperLinkAlert__modal_overlay'></div>"
    );

    const hyperLinkAlert = htmlToElement<HTMLDivElement>(
      '<div id="hyperLinkAlert" class="hyperLink-alert--v2"></div>'
    );

    const { description, title, popupImgUrl, buttonText } =
      this.popupTypeMessage(popupType);

    const hyperLinkMessageAndButtonContainer = htmlToElement<HTMLDivElement>(
      '<div id="hyperLinkAlert__message_btn_container">' +
        `<div id="hyperLinkAlert__message_container">` +
        `${
          popupImgUrl
            ? `<div id="hyperLinkLogo_container"><img id="hyperLinkAlert_logo" src="${popupImgUrl}"></img></div>`
            : ""
        }` +
        `<h1 id="hyperLinkAlert__title">${title}</h1>` +
        `${
          description ? `<p id="hyperLinkAlert__desc">${description}</p>` : ""
        }` +
        "</div>" +
        "</div>"
    );

    const successAlert = htmlToElement(
      `<div><button id="hyperLinkAlert__btn">${buttonText}</button></div>`
    );
    const btnContainer = htmlToElement(
      '<div id="hyperLinkAlert__btn-container"></div>'
    );

    const closeButtonIconUrl = getCloseButtonUrl(this.buildEnv);
    const closeButton = htmlToElement(
      `<div id="hyperLinkAlert__close-btn"><img id="hyperLinkAlert__close-btn-image" src="${closeButtonIconUrl}"/></div>`
    );
    if (buttonText) {
      btnContainer.appendChild(successAlert);
      hyperLinkMessageAndButtonContainer.appendChild(btnContainer);
    }
    hyperLinkAlert.appendChild(hyperLinkMessageAndButtonContainer);
    innerContainer.appendChild(hyperLinkAlert);
    innerContainer.appendChild(closeButton);
    modal.appendChild(innerContainer);
    modal.appendChild(overlay);

    const removePopupBlockedAlert = () => {
      modal.remove();
      if (
        this.hyperLinkAlertContainer &&
        this.hyperLinkAlertContainer.children.length === 0
      ) {
        this.hyperLinkAlertContainer.style.display = "none";
      }
    };

    const bindOnLoad = () => {
      btnContainer.addEventListener("click", () => {
        onClick();
        removePopupBlockedAlert();
      });
    };

    const bindCloseButton = () => {
      closeButton.addEventListener("click", () => {
        removePopupBlockedAlert();
        onClose();
      });
      overlay.addEventListener("mousedown", () => {
        removePopupBlockedAlert();
        onClose();
      });
    };

    const attachOnLoad = () => {
      if (this.hyperLinkAlertContainer) {
        this.hyperLinkAlertContainer.appendChild(modal);
      }
    };

    attachOnLoad();
    bindCloseButton();
    if (buttonText) {
      bindOnLoad();
    }
    if (this.hyperLinkAlertContainer) {
      this.hyperLinkAlertContainer.style.display = "block";
    }
  }

  private getQueryParams(): Record<string, string> {
    const params: Record<string, string> = {};
    const queryString = window.location.search.slice(1);
    queryString.split("&").forEach((pair) => {
      const [key, value] = pair.split("=");
      params[decodeURIComponent(key)] = decodeURIComponent(value);
    });
    return params;
  }

  private showIframe = () => {
    if (this.hyperLinkIframe) {
      this.hyperLinkIframe.style.display = "block";
    }
  };

  async init({
    directConnect,
    autoConnect: autoConnect,
    forceClickToContinue: forceClickToContinue,
    showErrorMessage,
    siwsInput,
    theme,
    hideDraggableWidget,
    hideWalletOnboard,
    onWalletHandshake,
  }: {
    directConnect: boolean;
    autoConnect?: boolean;
    forceClickToContinue?: boolean;
    showErrorMessage?: boolean;
    siwsInput?: CustomSolanaSignInInput;
    theme?: HyperLinkWalletAdapterTheme;
    hideDraggableWidget?: boolean;
    hideWalletOnboard?: boolean;
    onWalletHandshake: (methods: {
      showWallet: (page?: EmbeddedWalletPage) => void;
      hideWallet: () => void;
    }) => void;
  }): Promise<{
    pk: string;
    siwsOutput?: SolanaSignInOutput;
  }> {
    if (this.isDisallowed()) {
      this.notifyDisallowed();
      return Promise.reject(new Error("Application not allowlisted"));
    }

    const queryParams = this.getQueryParams();
    const promptHyperLinkAutoConnectFromRedirect =
      !!queryParams.promptHyperLinkAutoConnect;
    const hyperLinkAutoConnect = !!queryParams.hyperLinkAutoConnect;
    if (promptHyperLinkAutoConnectFromRedirect || hyperLinkAutoConnect) {
      directConnect = false;
      autoConnect = true;
    }
    let windowParams: WindowOpenParams | undefined = undefined;
    const isThemed = theme !== "system";
    if (directConnect && !promptHyperLinkAutoConnectFromRedirect) {
      windowParams = this.windowCommunicator.openPopup(
        `/embedded_adapter_login?ref=${window.location.origin}${
          //Note this is how this how tiplink is connecting
          isThemed ? `&theme=${theme}` : ""
        }`
      );
      if (!windowParams.popup || windowParams.popup.closed) {
        directConnect = false;
        forceClickToContinue = true;
      }
    }
    console.log(windowParams);
    const siwsInputPromise =
      typeof siwsInput === "function"
        ? siwsInput()
        : siwsInput
          ? Promise.resolve(siwsInput)
          : undefined;
    console.log("121");
    const hyperLinkUrl = iFrameUrl({
      buildEnv: this.buildEnv,
      clientId: this.clientId,
      walletAdapterNetwork: this._walletAdapterNetwork,
      autoConnect,
      hyperLinkAutoConnect,
      theme: theme && isThemed ? theme : undefined,
      hideDraggableWidget,
      hideWalletOnboard,
    });
    console.log("1212121", hyperLinkUrl);
    this.hyperLinkIframe = htmlToElement<HTMLIFrameElement>(
      `<iframe
        id="${iframeId(this.hyperLinkSessionId)}"
        class="hyperLinkIframe"
        allowtransparency="true"
        src="${hyperLinkUrl}"
        style="display: none; position: fixed; top: 0; right: 0; width: 100%; background-color: transparent;
        height: 100%; border: none; border-radius: 0; z-index: 2147483647; color-scheme: light; pointer-events: auto;"
      ></iframe>`
    );

    const cssLink = new URL("/css/widget.css", getHyperLinkUrl(this.buildEnv));
    this.styleLink = htmlToElement<HTMLLinkElement>(
      `<link href="${cssLink.toString()}" rel="stylesheet" type="text/css">`
    );

    this.hyperLinkAlertContainer = htmlToElement<HTMLDivElement>(
      `<div id="hyperLinkAlertContainer" style="display:none; z-index: 2147483647"></div>`
    );

    this.hyperLinkToastContainer = htmlToElement<HTMLDivElement>(
      `<div id="hyperLinkToastContainer" style="display:none; z-index: 2147483647"></div>`
    );

    let fnsAtEnd: (() => void)[] = [];
    let checkPopupClosed: NodeJS.Timeout | undefined = undefined;
    let checkUrlForPausedExecution: NodeJS.Timeout | undefined = undefined;
    let iframeNotLoading: NodeJS.Timeout | undefined = undefined;
    let doCheckUrlForPausedExecution = false;
    fnsAtEnd.push(() => {
      clearInterval(checkPopupClosed);
      clearInterval(checkUrlForPausedExecution);
      clearInterval(iframeNotLoading);
    });

    const handleSetup = async (): Promise<{
      pk: string;
      siwsOutput?: SolanaSignInOutput;
    }> => {
      return new Promise<{
        pk: string;
        siwsOutput?: SolanaSignInOutput;
      }>((resolve, reject) => {
        // console.log("actually RUNNING handle setup");
        if (directConnect) {
          checkUrlForPausedExecution = setInterval(() => {
            if (!doCheckUrlForPausedExecution) {
              return;
            }
            try {
              const url = this.hyperLinkIframe?.contentWindow?.document.URL;

              console.log("url", url);
              if (url === "about:blank") {
                console.log("got in");
                console.error("iframe is not loading");
                // it is possible in mobile safari that the iframe in the background tab doesn't
                // finish loading before the new window is opened. The window will then auto-close
                // due to a timeout, and we'll show the login page instead.
                clearInterval(checkUrlForPausedExecution);
                iframeNotLoading = setInterval(() => {
                  windowParams?.popup.postMessage(
                    { type: "iframe_not_loading" },
                    getHyperLinkUrl(this.buildEnv)
                  );
                }, 1_000);
              }
            } catch (error) {
              // best effort, no need to handle
            }
          }, 300);
          checkPopupClosed = setInterval(() => {
            if (!windowParams?.popup || windowParams?.popup.closed) {
              clearInterval(checkPopupClosed);
              try {
                const url = this.hyperLinkIframe?.contentWindow?.document?.URL;
                if (url === "about:blank") {
                  fnsAtEnd.forEach((fn) => fn());
                  fnsAtEnd = [];
                  this.clearElements();
                  this.init({
                    directConnect: false,
                    autoConnect: true,
                    forceClickToContinue: true,
                    showErrorMessage: true,
                    theme,
                    siwsInput,
                    hideDraggableWidget,
                    hideWalletOnboard,
                    onWalletHandshake,
                  })
                    .then((result) => {
                      resolve(result);
                    })
                    .catch((error) => {
                      reject(error);
                    });
                  return;
                }
              } catch {
                // best effort, no need to handle
              }

              if (this.hyperLinkIframe?.contentWindow) {
                this.windowCommunicator.singlePostToWindow(
                  this.hyperLinkIframe.contentWindow,
                  {
                    type: "click_to_continue",
                    title: this.title,
                  }
                );
                this.showIframe();
              }
            }
          }, 300);
        }
        try {
          if (this.hyperLinkIframe === undefined) {
            throw Error("hyperLinkIframe is undefined");
          }
          if (this.hyperLinkAlertContainer === undefined) {
            throw Error("hyperLinkAlertContainer is undefined");
          }
          if (this.hyperLinkToastContainer === undefined) {
            throw Error("hyperLinkToastContainer is undefined");
          }
          if (this.styleLink === undefined) {
            throw Error("hyperLinkStyles is undefined");
          }
          // const start = Date.now();
          // console.log("appending child to iframe at:", start);
          window.document.head.appendChild(this.styleLink);
          window.document.body.appendChild(this.hyperLinkIframe);
          window.document.body.appendChild(this.hyperLinkAlertContainer);
          window.document.body.appendChild(this.hyperLinkToastContainer);

          if (this.isDisallowed()) {
            this.notifyDisallowed();
            windowParams?.popup?.close();
            reject(new Error("Application not allowlisted"));
            return;
          }

          doCheckUrlForPausedExecution = true;

          let requestAnimationFrameTimeout: NodeJS.Timeout | undefined =
            undefined;
          const callback = (timestamp: number) => {
            // console.log("timestamp", timestamp);
            if (timestamp) {
              clearTimeout(requestAnimationFrameTimeout);
              doCheckUrlForPausedExecution = false;
              setTimeout(() => {
                // console.log(
                //   "started nested request animation frame",
                //   Date.now()
                // );
                // It is possible that the iframe loads a bit at first,
                // so we set doCheckUrlForPausedExecution to false. However,
                // we try requesting animation frame again shortly after
                // and if times out, we set doCheckUrlForPausedExecution to true
                // so that in the `checkUrlForPausedExecution` interval above it
                // will indeed check. Note that we're not overly worried about
                // this flag changing back to true unncessarily because we have the
                // iframe url check against about:blank in the `checkUrlForPausedExecution`
                // interval above
                requestAnimationFrameTimeout = setTimeout(() => {
                  // console.log("Hit timeout at", Date.now());
                  doCheckUrlForPausedExecution = true;
                }, 500);
                window.requestAnimationFrame(callback);
              }, 300);
            }
          };
          window.requestAnimationFrame(callback);

          this.hyperLinkIframe.addEventListener("load", async () => {
            if (!this.hyperLinkIframe) {
              throw Error("hyperLinkIframe is undefined");
            }
            if (this.hyperLinkIframe.contentWindow === null) {
              throw Error("hyperLinkIframe.contentWindow is null");
            }

            this.showIframe();

            let postReadyInterval: NodeJS.Timeout | undefined = undefined;
            let windowPost: PostFn | undefined = undefined;

            if (windowParams?.popup && !windowParams.popup.closed) {
              const { post, close } =
                // TODO: this abstraction kind of sucks, this should not require an await
                await this.windowCommunicator.setupHandshakeWithWindowParams(
                  windowParams,
                  {
                    window_ack: {
                      type: CallbackType.DEFAULT,
                      cb: async (data: any) => {
                        // console.log("received window ack", data);
                        clearInterval(postReadyInterval);
                      },
                    },
                    done: {
                      type: CallbackType.DEFAULT,
                      cb: async (data: any) => {
                        // console.log("!!received done", data);
                        this.showIframe();
                        close();
                      },
                    },
                  },
                  ["done"]
                );
              // console.log("got window post function!!");
              windowPost = post;
            }

            // console.log("!!! setting up handhsake with iframe!!");
            const { close: closeIframeChannel } =
              this.windowCommunicator.setupHandshakeWithIframe(
                this.hyperLinkIframe,
                {
                  ready: {
                    type: CallbackType.DEFAULT,
                    cb: async (data: any) => {
                      // console.log('received "ready" message from iframe', data);
                      if (this.hyperLinkIframe?.contentWindow) {
                        this.windowCommunicator.singlePostToWindow(
                          this.hyperLinkIframe.contentWindow,
                          {
                            type: "ack",
                            title: this.title,
                            dAppSessionId: this.dAppSessionId,
                            hyperLinkSessionId: this.hyperLinkSessionId,
                          }
                        );
                      }
                      // TODO: use better flag to send to window post
                      // console.log("sending ready messages to window!");
                      windowPost?.({
                        type: "ready",
                        dAppSessionId: this.dAppSessionId,
                        hyperLinkSessionId: this.hyperLinkSessionId,
                      });
                      if (windowPost) {
                        postReadyInterval = setInterval(() => {
                          windowPost?.({
                            type: "ready",
                            dAppSessionId: this.dAppSessionId,
                            hyperLinkSessionId: this.hyperLinkSessionId,
                          });
                        }, 200);
                      }

                      if (
                        (directConnect &&
                          (!windowParams?.popup ||
                            windowParams.popup.closed)) ||
                        forceClickToContinue
                      ) {
                        clearInterval(checkPopupClosed);
                        if (this.hyperLinkIframe?.contentWindow) {
                          this.windowCommunicator.singlePostToWindow(
                            this.hyperLinkIframe.contentWindow,
                            {
                              type: "click_to_continue",
                              showErrorMessage,
                              title: this.title,
                            }
                          );
                        }
                        this.showIframe();
                      } else if (
                        !directConnect &&
                        !promptHyperLinkAutoConnectFromRedirect
                      ) {
                        clearInterval(checkPopupClosed);
                        // console.log("TRYING TO SINGLE POST!");
                        if (this.hyperLinkIframe?.contentWindow) {
                          this.windowCommunicator.singlePostToWindow(
                            this.hyperLinkIframe.contentWindow,
                            {
                              type: "embedded_login",
                            }
                          );
                        }
                        // console.log(
                        //   "displaying iframe for embedded_login after",
                        //   Date.now() - start
                        // );
                        this.showIframe();
                      } else if (promptHyperLinkAutoConnectFromRedirect) {
                        clearInterval(checkPopupClosed);
                        if (this.hyperLinkIframe?.contentWindow) {
                          this.windowCommunicator.singlePostToWindow(
                            this.hyperLinkIframe.contentWindow,
                            {
                              type: "tiplink_autoconnect_from_redirect",
                              title: this.title,
                            }
                          );
                        }
                        // console.log(
                        //   "displaying iframe for tiplink autoconnect from redirect after",
                        //   Date.now() - start
                        // );
                        this.showIframe();
                      }
                    },
                  },
                  ready_for_tiplink_autoconnect: {
                    type: CallbackType.DEFAULT,
                    cb: async (data: any) => {
                      // console.log(
                      //   "received ready_for_tiplink_autoconnect",
                      //   data
                      // );
                      if (this.hyperLinkIframe?.contentWindow) {
                        this.windowCommunicator.singlePostToWindow(
                          this.hyperLinkIframe.contentWindow,
                          {
                            type: "ack",
                            title: this.title,
                          }
                        );
                      }
                    },
                  },
                  loaded_public_key: {
                    type: CallbackType.DEFAULT,
                    cb: async (data: any) => {
                      clearInterval(checkPopupClosed);
                      // console.log("RECEIVED LOADED PUBLIC_KEY");
                      this.hideIframe();
                      if (this.hyperLinkIframe?.contentWindow) {
                        this.windowCommunicator.singlePostToWindow(
                          this.hyperLinkIframe.contentWindow,
                          {
                            type: "ack_loaded_public_key",
                            title: this.title,
                            dAppSessionId: this.dAppSessionId,
                            hyperLinkSessionId: this.hyperLinkSessionId,
                          }
                        );
                      }
                      // console.log(
                      //   'received "loaded_public_key" message from iframe',
                      //   data.publicKey
                      // );
                      this.publicKeyString = data.publicKey;
                      if (siwsInputPromise) {
                        const siwsOutput = await this._signIn(
                          siwsInputPromise,
                          true
                        );
                        if (!siwsOutput) {
                          reject(new Error("missing siwsOutput"));
                        }
                        resolve({
                          pk: data.publicKey,
                          siwsOutput,
                        });
                      }
                      resolve({
                        pk: data.publicKey,
                      });
                    },
                  },
                  public_key: {
                    type: CallbackType.DEFAULT,
                    cb: async (data: any) => {
                      clearInterval(checkPopupClosed);
                      // console.log("RECEIVED PUBLIC_KEY");
                      this.hideIframe();
                      // console.log(
                      //   'received "public_key" message from iframe',
                      //   data.publicKey
                      // );
                      this.publicKeyString = data.publicKey;
                      if (
                        promptHyperLinkAutoConnectFromRedirect ||
                        hyperLinkAutoConnect
                      ) {
                        this.showHyperLinkAutoconnectToast();
                      }
                      if (siwsInputPromise) {
                        const siwsOutput = await this._signIn(
                          siwsInputPromise,
                          true
                        );
                        if (!siwsOutput) {
                          reject(new Error("missing siwsOutput"));
                        }
                        resolve({
                          pk: data.publicKey,
                          siwsOutput,
                        });
                      }
                      resolve({
                        pk: data.publicKey,
                      });
                    },
                  },
                  cancel_connect: {
                    type: CallbackType.DEFAULT,
                    cb: async (data: any) => {
                      // console.log("RECEIVED CANCEL_CONNECT");
                      this.hideIframe();
                      windowParams?.popup?.close();
                      this.cleanUp();
                      reject(new Error("user clicked close button in iframe"));
                    },
                  },
                  focus_login: {
                    type: CallbackType.DEFAULT,
                    cb: async (data: any) => {
                      windowParams?.popup?.focus();
                    },
                  },
                },
                ["public_key", "cancel_connect", "loaded_public_key"]
              );
            fnsAtEnd.push(closeIframeChannel);
          });
        } catch (error) {
          // console.log("REJECTING error", error);
          // console.log("rejected via errior");
          reject(error);
        }
      });
    };
    // console.log("readying document");
    await documentReady();
    // console.log("handling setup");
    return handleSetup()
      .then((result) => {
        fnsAtEnd.forEach((fn) => fn());
        return result;
      })
      .then((result) => {
        let handshake:
          | {
              post: PostFn;
              close: CloseFn;
            }
          | undefined;
        if (this.hyperLinkIframe?.contentWindow) {
          handshake = this.windowCommunicator.setupHandshakeWithIframe(
            this.hyperLinkIframe,
            {
              show_wallet: {
                type: CallbackType.DEFAULT,
                cb: async () => {
                  this.showIframe();
                },
              },
              hide_wallet: {
                type: CallbackType.DEFAULT,
                cb: async () => {
                  this.hideIframe();
                },
              },
              hide_wallet_notification: {
                type: CallbackType.DEFAULT,
                cb: async () => {
                  this.hideWidgetNotificationUi();
                },
              },
              show_wallet_notification: {
                type: CallbackType.DEFAULT,
                cb: async () => {
                  this.showWidgetNotificationUi();
                },
              },
            },
            []
          );
          if (handshake) {
            onWalletHandshake({
              showWallet: (page?: EmbeddedWalletPage) => {
                switch (page) {
                  case EmbeddedWalletPage.ADD_FUNDS:
                  case EmbeddedWalletPage.SWAP:
                  case EmbeddedWalletPage.WITHDRAW:
                    handshake?.post({ type: "show_wallet", page });
                    break;
                  case EmbeddedWalletPage.OVERVIEW:
                  default:
                    handshake?.post({ type: "show_wallet" });
                }
              },
              hideWallet: () => {
                handshake?.post({ type: "hide_wallet" });
              },
            });
          }
          this._walletHandshake = handshake;
        }
        // skip wallet widget setup if unwanted (effectively hides widget)
        if (hideDraggableWidget) return result;
        // setup wallet widget
        this.hyperLinkDraggableWidget = setupWalletWidget({
          onDragStart: () => {
            this._isDragging = true;
          },
          onDragEnd: () => {
            this._isDragging = false;
          },
          isDragging: () => this._isDragging,
          setInteractable: (interactable: Interact.Interactable) => {
            this._interactable = interactable;
          },
          handleWidgetClick: () => {
            if (this._walletHandshake) {
              this._walletHandshake.post({ type: "show_wallet" });
            } else {
              // fallback re-establish handshake
              if (this.hyperLinkIframe?.contentWindow) {
                const handshake:
                  | {
                      post: PostFn;
                      close: CloseFn;
                    }
                  | undefined =
                  this.windowCommunicator.setupHandshakeWithIframe(
                    this.hyperLinkIframe,
                    {
                      show_wallet: {
                        type: CallbackType.DEFAULT,
                        cb: async () => {
                          this.showIframe();
                        },
                      },
                      hide_wallet: {
                        type: CallbackType.DEFAULT,
                        cb: async () => {
                          this.hideIframe();
                        },
                      },
                      hide_wallet_notification: {
                        type: CallbackType.DEFAULT,
                        cb: async () => {
                          this.hideWidgetNotificationUi();
                        },
                      },
                      show_wallet_notification: {
                        type: CallbackType.DEFAULT,
                        cb: async () => {
                          this.showWidgetNotificationUi();
                        },
                      },
                    },
                    []
                  );
                if (handshake) {
                  onWalletHandshake({
                    showWallet: (page?: EmbeddedWalletPage) => {
                      switch (page) {
                        case EmbeddedWalletPage.ADD_FUNDS:
                        case EmbeddedWalletPage.SWAP:
                        case EmbeddedWalletPage.WITHDRAW:
                          handshake?.post({ type: "show_wallet", page });
                          break;
                        case EmbeddedWalletPage.OVERVIEW:
                        default:
                          handshake?.post({ type: "show_wallet" });
                      }
                    },
                    hideWallet: () => {
                      handshake?.post({ type: "hide_wallet" });
                    },
                  });
                  handshake.post({ type: "show_wallet" });
                  this._walletHandshake = handshake;
                }
              }
            }
          },
          theme: this.theme,
          windowDraggableResizeListener:
            this.draggableWidgetWindowResizeListener,
          windowDraggableScrollListener:
            this.draggableWidgetWindowScrollListener,
          hyperLinkSessionId: this.hyperLinkSessionId,
        });
        return result;
      });
  }

  async cleanUp(): Promise<void> {
    // console.log("cleaning up");
    if (this.hyperLinkIframe) {
      const iFrame = this.hyperLinkIframe;
      await new Promise<void>((resolve) => {
        const { post: postToIframe } =
          this.windowCommunicator.setupHandshakeWithIframe(
            iFrame,
            {
              disconnected: {
                type: CallbackType.DEFAULT,
                cb: async () => {
                  resolve();
                },
              },
            },
            ["disconnected"]
          );
        postToIframe({ type: "disconnect" });
      });
    }
    this.publicKeyString = undefined;
    this.clearElements();
  }

  clearElements(): void {
    localStorage.removeItem("hyperLink_pk_connected");
    tearDownWalletWidget(
      this.draggableWidgetWindowResizeListener,
      this.draggableWidgetWindowScrollListener,
      this._interactable,
      this.hyperLinkDraggableWidget
    );

    if (
      this.styleLink &&
      isElement(this.styleLink) &&
      window.document.head.contains(this.styleLink)
    ) {
      this.styleLink.remove();
      this.styleLink = undefined;
    }
    if (
      this.hyperLinkIframe &&
      isElement(this.hyperLinkIframe) &&
      window.document.body.contains(this.hyperLinkIframe)
    ) {
      this.hyperLinkIframe.remove();
      this.hyperLinkIframe = undefined;
    }
    if (
      this.hyperLinkAlertContainer &&
      isElement(this.hyperLinkAlertContainer) &&
      window.document.body.contains(this.hyperLinkAlertContainer)
    ) {
      this.hyperLinkAlertContainer.remove();
      this.hyperLinkAlertContainer = undefined;
    }
    if (
      this.hyperLinkToastContainer &&
      isElement(this.hyperLinkToastContainer) &&
      window.document.body.contains(this.hyperLinkToastContainer)
    ) {
      this.hyperLinkToastContainer.remove();
      this.hyperLinkToastContainer = undefined;
    }
    removePreviousWindowRef(HyperLinkInstanceKey.EMBED);
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async buildTransactionMessage(
    transaction: Transaction | VersionedTransaction
  ): Promise<{
    message: string;
  }> {
    if (isVersionedTransaction(transaction)) {
      return {
        message: Buffer.from(transaction.serialize()).toString("base64"),
      };
    }
    return {
      message: transaction
        .serialize({ requireAllSignatures: false })
        .toString("base64"),
    };
  }

  async _signTransaction({
    transaction,
    doSend,
  }: {
    transaction: Transaction | VersionedTransaction;
    doSend: boolean;
  }): Promise<string> {
    this.extendSession();
    // console.log("signing transaction");
    const msg = await this.buildTransactionMessage(transaction);
    return await new Promise<string>((resolve, reject) => {
      if (!this.hyperLinkIframe) {
        reject(new Error("iframe is missing"));
        return;
      }
      this.showIframe();
      const requestId = uuid();
      const { post } = this.windowCommunicator.setupHandshakeWithIframe(
        this.hyperLinkIframe,
        {
          signed_transaction: {
            type: CallbackType.DEFAULT,
            cb: async (data: any) => {
              this.hideIframe();
              resolve(data.signed_transaction);
            },
          },
          transaction_closed: {
            type: CallbackType.DEFAULT,
            cb: async () => {
              this.hideIframe();
              reject(new Error("User rejected transaction"));
            },
          },
          sign_error: {
            type: CallbackType.DEFAULT,
            cb: async (data: any) => {
              this.hideIframe();

              if (data && "message" in data) {
                reject(new Error(data.message));
              }

              reject(new Error("Unknown error while signing transaction"));
            },
          },
        },
        ["signed_transaction", "transaction_closed", "sign_error"],
        requestId
      );
      post({
        ...msg,
        type: "sign_transaction",
        doSend,
        requestId,
      });
    });
  }

  transactionFromString(
    isVersioned: boolean,
    signedTransactionMsg: string
  ): Transaction | VersionedTransaction {
    if (isVersioned) {
      return VersionedTransaction.deserialize(
        Buffer.from(signedTransactionMsg, "base64")
      );
    } else {
      return Transaction.from(Buffer.from(signedTransactionMsg, "base64"));
    }
  }

  async signTransaction<T extends Transaction | VersionedTransaction>(
    transaction: T
  ): Promise<T> {
    const signedTransaction = await this._signTransaction({
      transaction,
      doSend: false,
    });
    return this.transactionFromString(
      isVersionedTransaction(transaction),
      signedTransaction
    ) as T;
  }

  async signAllTransactions<T extends Transaction | VersionedTransaction>(
    transactions: T[]
  ): Promise<T[]> {
    this.extendSession();

    const messages = await Promise.all(
      transactions.map(async (transaction) => {
        const isVersioned = isVersionedTransaction(transaction);
        const { message } = await this.buildTransactionMessage(transaction);
        return {
          message,
          isVersioned,
        };
      })
    );

    const signedTxnMessages = await new Promise<string[]>((resolve, reject) => {
      if (!this.hyperLinkIframe) {
        reject(new Error("iframe is missing"));
        return;
      }
      this.showIframe();
      const requestId = uuid();
      const { post } = this.windowCommunicator.setupHandshakeWithIframe(
        this.hyperLinkIframe,
        {
          signed_transactions: {
            type: CallbackType.DEFAULT,
            cb: async (data: any) => {
              this.hideIframe();
              resolve(data.signed_transactions);
            },
          },
          transaction_closed: {
            type: CallbackType.DEFAULT,
            cb: async () => {
              this.hideIframe();
              reject(new Error("User rejected transaction"));
            },
          },
          sign_error: {
            type: CallbackType.DEFAULT,
            cb: async (data: any) => {
              this.hideIframe();

              if (data && "message" in data) {
                reject(new Error(data.message));
              } else {
                reject(
                  new Error("Unknown error while signing transaction messages")
                );
              }
            },
          },
        },
        ["signed_transactions", "transaction_closed", "sign_error"],
        requestId
      );
      post({
        type: "sign_all_transactions",
        messages: messages.map((msg) => msg.message),
        requestId,
      });
    });

    return signedTxnMessages.map((signedTxnMsg, i) => {
      return this.transactionFromString(
        messages[i].isVersioned,
        signedTxnMsg
      ) as T;
    });
  }

  private async _signMessage(
    message: Uint8Array,
    type: string,
    skipConfirm?: boolean
  ): Promise<{ data: Uint8Array; extraInfo: any }> {
    return new Promise<{ data: Uint8Array; extraInfo: any }>(
      (resolve, reject) => {
        // TODO: do we still need to extend session
        if (!this.hyperLinkIframe) {
          reject(new Error("iframe is missing"));
          return;
        }
        this.extendSession();
        const requestId = uuid();
        const { post } = this.windowCommunicator.setupHandshakeWithIframe(
          this.hyperLinkIframe,
          {
            signed_message: {
              type: CallbackType.DEFAULT,
              cb: async (data: any) => {
                this.hideIframe();
                const signedMessage = Buffer.from(
                  data.signed_message,
                  "base64"
                );
                resolve({ data: signedMessage, extraInfo: data.extraInfo });
              },
            },
            message_closed: {
              type: CallbackType.DEFAULT,
              cb: async () => {
                this.hideIframe();
                reject(new Error("User rejected message"));
              },
            },
            sign_error: {
              type: CallbackType.DEFAULT,
              cb: async (data: any) => {
                this.hideIframe();

                if (data && "message" in data) {
                  reject(new Error(data.message));
                } else {
                  reject(new Error("Unknown error while signing message"));
                }
              },
            },
          },
          ["signed_message", "message_closed", "sign_error"],
          requestId
        );
        this.showIframe();
        post({
          message: Buffer.from(message).toString("base64"),
          type,
          requestId,
          skipConfirm,
        });
      }
    );
  }

  async signMessage(message: Uint8Array): Promise<{ signature: Uint8Array }> {
    const { data } = await this._signMessage(message, "sign_message");
    return { signature: data };
  }

  private async _signIn(
    customInput?: Promise<SolanaSignInInput>,
    skipConfirm?: boolean
  ): Promise<SolanaSignInOutput> {
    const input = await customInput;
    const publicKeyAddress = input?.address || this.publicKeyString;
    if (!publicKeyAddress) {
      throw new Error("not connected!");
    }
    const domain = input?.domain || window.location.host;
    if (!domain) {
      throw new Error("no domain found!");
    }
    const siwsRequiredFields = {
      ...input,
      domain,
      address: publicKeyAddress,
    } as SolanaSignInInputWithRequiredFields;
    const signInMessage = createSignInMessage(siwsRequiredFields);
    const { data: signature, extraInfo } = await this._signMessage(
      signInMessage,
      "siws",
      skipConfirm
    );
    return {
      account: new ReadonlyWalletAccount({
        address: publicKeyAddress,
        publicKey: new PublicKey(publicKeyAddress).toBytes(),
        chains: [SOLANA_MAINNET_CHAIN],
        // These must be included, otherwise the Standard Wallet Adapter
        // will assume these features don't exist on the wallet adapter
        features: [
          SolanaSignAndSendTransaction,
          SolanaSignTransaction,
          SolanaSignMessage,
          SolanaSignIn,
        ],
      }),
      signedMessage: signInMessage,
      signature,
      // @ts-ignore
      extraInfo,
    };
  }

  async signIn(
    input?: Promise<SolanaSignInInput>
  ): Promise<SolanaSignInOutput> {
    return this._signIn(input);
  }

  // This is copied from the `sendTransaction` method in BaseSignerWalletAdapter,
  // with the changes to use our own internal _signTransaction method, and to pass in the
  // cluster nodes for the connectino that was passed into `sendTransaction`.
  // we also don't emit an error since the method calling this is responsible for that.
  async sendTransaction<T extends Transaction | VersionedTransaction>(
    transaction: T,
    prepareTransaction: (
      transaction: Transaction,
      connection: Connection,
      sendOptions: Omit<SendTransactionOptions, "signers">
    ) => Promise<Transaction>,
    connection: Connection,
    options: SendTransactionOptions = {}
  ): Promise<TransactionSignature> {
    if (isVersionedTransaction(transaction)) {
      try {
        const transactionString = await this._signTransaction({
          transaction,
          doSend: true,
        });

        const rawTransaction = Buffer.from(transactionString, "base64");

        return await connection.sendRawTransaction(rawTransaction, options);
      } catch (error: any) {
        if (error instanceof WalletSignTransactionError) {
          throw error;
        }
        throw new WalletSendTransactionError(error?.message, error);
      }
    } else {
      try {
        const { signers, ...sendOptions } = options;

        const txn = await prepareTransaction(
          transaction as Transaction,
          connection,
          sendOptions
        );

        signers?.length && txn.partialSign(...signers);

        const transactionString = await this._signTransaction({
          transaction: txn,
          doSend: true,
        });

        const rawTransaction = Buffer.from(transactionString, "base64");

        return await connection.sendRawTransaction(rawTransaction, sendOptions);
      } catch (error: any) {
        if (error instanceof WalletSignTransactionError) {
          throw error;
        }
        throw new WalletSendTransactionError(error?.message, error);
      }
    }
  }

  notifyDisallowed() {
    try {
      this.clearElements();
    } catch {
      // best effort
    }
    console.error(
      window.location.origin,
      "not allowlisted – please contact the HyperLink team at contact@tiplink.io to be added."
    );
    showDialog(
      this.buildEnv,
      `<p>${window.location.origin} does not have access yet ` +
        "to use the HyperLink Wallet Adapter. Please reach out to the " +
        'HyperLink team at <a style="text-decoration: underline;" href="mailto:contact@tiplink.io" target="_blank"> ' +
        "contact@tiplink.io</a> or reach out via our " +
        '<a style="text-decoration: underline;" href="https://discord.com/invite/4bXYT7dxR3" target="_blank" >' +
        "discord</a>.</p>"
    );
  }
}
