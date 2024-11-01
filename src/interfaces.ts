export const HYPERLINK_BUILD_ENV = {
    PRODUCTION: "production",
    STAGING: "staging",
    DEVELOPMENT: "development",
    ADAPTER: "adapter",
    LOCAL: "local",
  } as const;
  
  export type HYPERLINK_BUILD_ENV_TYPE =
    (typeof HYPERLINK_BUILD_ENV)[keyof typeof HYPERLINK_BUILD_ENV];