import { HYPERLINK_BUILD_ENV_TYPE } from "./interfaces";

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