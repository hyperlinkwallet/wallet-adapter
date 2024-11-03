import { htmlToElement } from "./embedUtils";
import { HYPERLINK_BUILD_ENV_TYPE } from "./interfaces";
import { getCloseButtonUrl } from "./utils";


export function showDialog(buildEnv: HYPERLINK_BUILD_ENV_TYPE, html: string) {
  const styleDiv = htmlToElement<HTMLDivElement>(
    "<style>" +
      "#hyperLinkAlert__close-btn {" +
      "  position: absolute;" +
      "  top: 0px;" +
      "  right: 0px;" +
      "  width: 44px;" +
      "  height: 44px;" +
      "  padding: 12px;" +
      "  display: flex;" +
      "  justify-content: center;" +
      "  align-items: center;" +
      "  user-select: none;" +
      "}" +
      "" +
      "#hyperLinkAlert__close-btn-image {" +
      "  width: 60%;" +
      "  height: 60%;" +
      "  cursor: pointer;" +
      "}" +
      "" +
      "#hyperLinkAlert__close-btn-image:hover {" +
      "  opacity: 50%;" +
      "}" +
      "" +
      ".not-allowed {" +
      "  min-width: 285px;" +
      "  position: fixed;" +
      "  top: 50%;" +
      "  left: 50%;" +
      "  transform: translate(-50%, -50%);" +
      "  z-index: 2147483647;" +
      "  background-color: #17303e;" +
      "  color: #ffffff;" +
      "  padding: 24px;" +
      "  border-radius: 8px;" +
      "  border-color: #e0e7eb;" +
      "  border-width: 2px;" +
      "  border: solid;" +
      "}" +
      "</style>"
  );
  window.document.head.appendChild(styleDiv);
  const closeButton = htmlToElement(
    `<div id="hyperLinkAlert__close-btn"><img id="hyperLinkAlert__close-btn-image" src="${getCloseButtonUrl(
      buildEnv
    )}"/></div>`
  );
  closeButton.addEventListener("click", () => {
    if (window.document.body.contains(notAllowedDiv)) {
      notAllowedDiv.remove();
    }
    if (window.document.head.contains(styleDiv)) {
      styleDiv.remove();
    }
  });
  const notAllowedDiv = htmlToElement<HTMLDivElement>(
    `<div class="not-allowed">${html}</div>`
  );
  notAllowedDiv.appendChild(closeButton);
  window.document.body.appendChild(notAllowedDiv);
}