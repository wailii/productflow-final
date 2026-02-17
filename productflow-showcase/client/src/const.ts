export { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";

// OAuth entry is handled server-side to support state signing/validation.
export const getLoginUrl = () => {
  return "/api/oauth/start";
};
