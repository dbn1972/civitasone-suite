"use client";

import type { WizardData, FieldErrors } from "../wizardTypes";
import {
  inputStyle,
  inputErrorStyle,
  labelStyle,
  fieldWrap,
  grid2,
} from "../wizardTypes";

interface Props {
  data: WizardData;
  errors: FieldErrors;
  onChange: <K extends keyof WizardData>(key: K, value: WizardData[K]) => void;
  onBlur: (field: keyof WizardData) => void;
}

export function Step1({ data, errors, onChange, onBlur }: Props) {
  return (
    <>
      <h2 style={{ fontSize: 16, fontWeight: 700, color: "#0f172a", marginTop: 0, marginBottom: 20 }}>
        Step 1 — Personal Info
      </h2>
      <div style={grid2}>
        {/* Full Name */}
        <div style={{ ...fieldWrap, gridColumn: "span 2" }}>
          <label htmlFor="w-fullName" style={labelStyle}>
            Full Name <span style={{ color: "#ef4444" }} aria-hidden="true">*</span>
          </label>
          <input
            id="w-fullName"
            type="text"
            autoComplete="name"
            value={data.fullName}
            onChange={(e) => onChange("fullName", e.target.value)}
            onBlur={() => onBlur("fullName")}
            placeholder="e.g. Priya Sharma"
            aria-required="true"
            aria-invalid={!!errors.fullName}
            aria-describedby={errors.fullName ? "w-fullName-err" : undefined}
            style={errors.fullName ? inputErrorStyle : inputStyle}
          />
          {errors.fullName && (
            <span id="w-fullName-err" role="alert" style={{ fontSize: 12, color: "#b91c1c" }}>
              {errors.fullName}
            </span>
          )}
        </div>

        {/* Date of Birth */}
        <div style={fieldWrap}>
          <label htmlFor="w-dob" style={labelStyle}>Date of Birth</label>
          <input
            id="w-dob"
            type="date"
            value={data.dateOfBirth}
            onChange={(e) => onChange("dateOfBirth", e.target.value)}
            style={inputStyle}
            max={new Date(Date.now() - 18 * 365.25 * 24 * 3600 * 1000).toISOString().split("T")[0]}
          />
        </div>

        {/* Gender */}
        <div style={fieldWrap}>
          <label htmlFor="w-gender" style={labelStyle}>Gender</label>
          <select
            id="w-gender"
            value={data.gender}
            onChange={(e) => onChange("gender", e.target.value as WizardData["gender"])}
            style={inputStyle}
          >
            <option value="">Select gender</option>
            <option value="male">Male</option>
            <option value="female">Female</option>
            <option value="other">Other / Prefer not to say</option>
          </select>
        </div>

        {/* Marital Status */}
        <div style={fieldWrap}>
          <label htmlFor="w-marital" style={labelStyle}>Marital Status</label>
          <select
            id="w-marital"
            value={data.maritalStatus}
            onChange={(e) => onChange("maritalStatus", e.target.value as WizardData["maritalStatus"])}
            style={inputStyle}
          >
            <option value="">Select status</option>
            <option value="single">Single</option>
            <option value="married">Married</option>
            <option value="divorced">Divorced</option>
            <option value="widowed">Widowed</option>
          </select>
        </div>

        {/* Blood Group */}
        <div style={fieldWrap}>
          <label htmlFor="w-blood" style={labelStyle}>Blood Group</label>
          <select
            id="w-blood"
            value={data.bloodGroup}
            onChange={(e) => onChange("bloodGroup", e.target.value as WizardData["bloodGroup"])}
            style={inputStyle}
          >
            <option value="">Select blood group</option>
            {(["A+", "A-", "B+", "B-", "O+", "O-", "AB+", "AB-"] as const).map((bg) => (
              <option key={bg} value={bg}>{bg}</option>
            ))}
          </select>
        </div>

        {/* Official Email */}
        <div style={fieldWrap}>
          <label htmlFor="w-email" style={labelStyle}>Official Email</label>
          <input
            id="w-email"
            type="email"
            autoComplete="email"
            value={data.email}
            onChange={(e) => onChange("email", e.target.value)}
            onBlur={() => onBlur("email")}
            placeholder="employee@gov.in"
            aria-invalid={!!errors.email}
            aria-describedby={errors.email ? "w-email-err" : undefined}
            style={errors.email ? inputErrorStyle : inputStyle}
          />
          {errors.email && (
            <span id="w-email-err" role="alert" style={{ fontSize: 12, color: "#b91c1c" }}>
              {errors.email}
            </span>
          )}
        </div>

        {/* Mobile */}
        <div style={fieldWrap}>
          <label htmlFor="w-mobile" style={labelStyle}>Mobile</label>
          <input
            id="w-mobile"
            type="tel"
            autoComplete="tel"
            value={data.mobile}
            onChange={(e) => onChange("mobile", e.target.value)}
            onBlur={() => onBlur("mobile")}
            placeholder="+91 98765 43210"
            aria-invalid={!!errors.mobile}
            aria-describedby={errors.mobile ? "w-mobile-err" : undefined}
            style={errors.mobile ? inputErrorStyle : inputStyle}
          />
          {errors.mobile && (
            <span id="w-mobile-err" role="alert" style={{ fontSize: 12, color: "#b91c1c" }}>
              {errors.mobile}
            </span>
          )}
        </div>
      </div>
    </>
  );
}
