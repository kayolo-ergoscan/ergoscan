"use client";

import { useEffect, useState } from "react";
import { PHONE_CHART_QUERY } from "./chart-axis";

/** True while the window is phone-narrow. Charts mount on the client only, so the first read is real. */
export function usePhoneChart(): boolean {
  const [phone, setPhone] = useState(
    () => typeof window !== "undefined" && window.matchMedia(PHONE_CHART_QUERY).matches
  );
  useEffect(() => {
    const mq = window.matchMedia(PHONE_CHART_QUERY);
    const on = () => setPhone(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return phone;
}
