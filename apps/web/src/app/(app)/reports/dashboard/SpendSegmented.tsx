"use client";

import { useState } from "react";
import { Segmented } from "../../../_components/ds";

const SEG_OPTIONS = ["FY", "QTD"];

export function SpendSegmented() {
  const [seg, setSeg] = useState("FY");
  return (
    <Segmented
      options={SEG_OPTIONS}
      value={seg}
      onChange={setSeg}
    />
  );
}
