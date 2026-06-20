export const COMMANDS = {
  structureCreate:  "payroll.structure.create",
  runCreate:        "payroll.run.create",
  runApprove:       "payroll.run.approve",
  runDisburse:      "payroll.run.disburse",
  loanCreate:       "payroll.loan.create",
  loanDisburse:     "payroll.loan.disburse",
} as const;

export const EVENTS = {
  runApproved:    "payroll.run.approved",
  loanDisbursed:  "payroll.loan.disbursed",
} as const;

export const SERVICE = "payroll";
