// Site-wide contact details. The page hides the phone line while it is empty.
export const site = {
  // Direct line shown under the lead form, e.g. "(555) 123-4567".
  phone: "",
  email: "contact@therecruitingline.com",
};

export function phoneHref(phone: string) {
  return "tel:" + phone.replace(/[^\d+]/g, "");
}
