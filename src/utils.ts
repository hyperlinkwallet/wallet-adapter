import { HyperLinkWalletAdapter, NPM_VERSION } from "./index";
import { HyperLinkEmbed } from "./embed";
import { HYPERLINK_BUILD_ENV_TYPE } from "./interfaces";
import { WalletAdapterNetwork } from "@solana/wallet-adapter-base";

export const getHyperLinkUrl = (buildEnv: HYPERLINK_BUILD_ENV_TYPE): string => {
  //TODO: Add the correct URL
  switch (buildEnv) {
    case "production":
      return "hyperlinkwallet.com";
    case "staging":
      return "hyperlinkwallet.com";
    case "development":
      return "hyperlinkwallet.com";
    case "adapter":
      return "hyperlinkwallet.com";
    case "local":
      return "hyperlinkwallet.com";
  }
};
export function getCloseButtonUrl(buildEnv: HYPERLINK_BUILD_ENV_TYPE): string {
  const logoUrl = new URL(
    "adapter-popup-close-icon.svg",
    getHyperLinkUrl(buildEnv)
  );
  return logoUrl.toString();
}

export function removePreviousWindowRef(key: HyperLinkInstanceKey) {
  if (!(key in HYPERLINK_INSTANCES)) return;
  HYPERLINK_INSTANCES[key] = undefined;
}

const iframePath = "embedded_wallet";
export const HYPERLINK_ADAPTER_KEY = "HyperLinkAdapter";
export const HYPERLINK_EMBED_KEY = "HyperLinkEmbed";
export enum HyperLinkInstanceKey {
  ADAPTER = HYPERLINK_ADAPTER_KEY,
  EMBED = HYPERLINK_EMBED_KEY,
}
const HYPERLINK_INSTANCES: Record<
  string,
  HyperLinkWalletAdapter | HyperLinkEmbed | undefined
> = {
  [HYPERLINK_ADAPTER_KEY]: undefined,
  [HYPERLINK_EMBED_KEY]: undefined,
};
export function iFrameUrl({
  buildEnv,
  clientId,
  hyperLinkAutoConnect,
  theme,
  hideDraggableWidget,
  autoConnect,
  walletAdapterNetwork,
  hideWalletOnboard,
}: {
  buildEnv: HYPERLINK_BUILD_ENV_TYPE;
  clientId: string;
  walletAdapterNetwork:
    | WalletAdapterNetwork.Mainnet
    | WalletAdapterNetwork.Devnet;
  hyperLinkAutoConnect?: boolean;
  theme?: string;
  hideDraggableWidget?: boolean;
  autoConnect?: boolean;
  hideWalletOnboard?: boolean;
}): string {
  const hyperLinkUrl = getHyperLinkUrl(buildEnv);
  const hyperLinkIframeUrl = new URL(iframePath, hyperLinkUrl);
  hyperLinkIframeUrl.searchParams.append("c", clientId);
  hyperLinkIframeUrl.searchParams.append(
    "ref",
    encodeURI(window.location.origin)
  );
  hyperLinkIframeUrl.searchParams.append("v", NPM_VERSION);
  if (autoConnect) {
    hyperLinkIframeUrl.searchParams.append("autoConnect", "true");
  }
  if (hyperLinkAutoConnect) {
    hyperLinkIframeUrl.searchParams.append("hyperLinkAutoConnect", "true");
  }
  if (theme) {
    hyperLinkIframeUrl.searchParams.append("theme", theme);
  }
  if (hideDraggableWidget) {
    hyperLinkIframeUrl.searchParams.append("hideWidget", "true");
  }
  if (hideWalletOnboard) {
    hyperLinkIframeUrl.searchParams.append("hideWalletOnboard", "true");
  }
  if (walletAdapterNetwork === WalletAdapterNetwork.Devnet) {
    hyperLinkIframeUrl.searchParams.append("devnet", "true");
  }
  return hyperLinkIframeUrl.href;
}
export function checkAndAttachHyperLinkInstance(
  hyperLinkInstance: HyperLinkWalletAdapter | HyperLinkEmbed
) {
  // determine key from instance passed
  const key =
    hyperLinkInstance instanceof HyperLinkWalletAdapter
      ? HYPERLINK_ADAPTER_KEY
      : hyperLinkInstance instanceof HyperLinkEmbed
        ? HYPERLINK_EMBED_KEY
        : "";
  if (!key) return;
  if (key in HYPERLINK_INSTANCES && HYPERLINK_INSTANCES[key]) {
    checkAndRemovePreviousHyperLinkInstance(key as HyperLinkInstanceKey);
  }
  HYPERLINK_INSTANCES[key] = hyperLinkInstance;
}
export function checkAndRemovePreviousHyperLinkInstance(
  key: HyperLinkInstanceKey
) {
  try {
    // disconnect previous instance (adapter or embed class)
    if (
      key === HyperLinkInstanceKey.ADAPTER &&
      HYPERLINK_INSTANCES[key] instanceof HyperLinkWalletAdapter
    ) {
      (HYPERLINK_INSTANCES[key] as HyperLinkWalletAdapter).disconnect();
    } else if (
      key === HyperLinkInstanceKey.EMBED &&
      HYPERLINK_INSTANCES[key] instanceof HyperLinkEmbed
    ) {
      (HYPERLINK_INSTANCES[key] as HyperLinkEmbed).clearElements();
    }
    // remove reference of previous instance
  } catch (err) {
    console.error(`Error removing previous ${key} instance: `, err);
  } finally {
    // detach ref even if error occurs
    removePreviousWindowRef(key);
  }
}
export function isElement(element: unknown) {
  return element instanceof Element || element instanceof Document;
}
