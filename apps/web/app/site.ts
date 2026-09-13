// Site-wide contact details. The page hides the phone line while it is empty.
export const site = {
  // Direct line shown under the lead form, e.g. "(555) 123-4567".
  phone: "",
  email: "contact@therecruitingline.com",
  // The dialer/CRM (apps/dialer). Override with NEXT_PUBLIC_DIALER_URL; in dev it runs on :3001.
  dialerLoginUrl:
    (process.env.NEXT_PUBLIC_DIALER_URL ??
      (process.env.NODE_ENV === "development" ? "http://localhost:3001" : "https://app.therecruitingline.com")) + "/login",
};

export function phoneHref(phone: string) {
  return "tel:" + phone.replace(/[^\d+]/g, "");
}
