import { z } from "zod";
import { bigintString } from "../../shared/validators.js";

export const fetchBillBody = z.object({
  assesseeIdentifier: z.string().min(1).max(100),
});

export const payBillBody = z.object({
  assesseeIdentifier: z.string().min(1).max(100),
  amountMinor: bigintString,
  bbpsTxnId: z.string().min(1).max(50),
  channel: z.string().min(1).max(30),
});
