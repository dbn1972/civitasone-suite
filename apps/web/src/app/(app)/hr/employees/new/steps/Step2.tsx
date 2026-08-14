"use client";

import type { WizardData, FieldErrors } from "../wizardTypes";
import {
  inputStyle,
  inputErrorStyle,
  labelStyle,
  fieldWrap,
  grid2,
} from "../wizardTypes";

type Dept = { id: string; name: string };
type Desig = { id: string; name: string };

interface Props {
  data: WizardData;
  errors: FieldErrors;
  departments: Dept[];
  designations: Desig[];
  onChange: <K extends keyof WizardData>(key: K, value: WizardData[K]) => void;
  onBlur: (field: keyof WizardData) => void;
}

const GRADES = [
  "Group A — Grade 1 (Pay Level 15–18)",
  "Group A — Grade 2 (Pay Level 12–14)",
  "Group B (Pay Level 6–11)",
  "Group C (Pay Level 1–5)",
  "MTS",
  "Contractual",
];

export function Step2({ data, errors, departments, designations, onChange, onBlur }: Props) {
  return (
    <>
      <h2 style={{ fontSize: 16, fontWeight: 700, color: "#0f172a", marginTop: 0, marginBottom: 20 }}>
        Step 2 — Employment
      </h2>
      <div style={grid2}>
        {/* Employee ID */}
        <div style={fieldWrap}>
          <label htmlFor="w-empNo" style={labelStyle}>
            Employee ID <span style={{ color: "#ef4444" }} aria-hidden="true">*</span>
          </label>
          <input
            id="w-empNo"
            type="text"
            value={data.employeeNo}
            onChange={(e) => onChange("employeeNo", e.target.value)}
            onBlur={() => onBlur("employeeNo")}
            placeholder="e.g. NIC/2026/0001"
            aria-required="true"
            aria-invalid={!!errors.employeeNo}
            aria-describedby={errors.employeeNo ? "w-empNo-err" : undefined}
            style={errors.employeeNo ? inputErrorStyle : inputStyle}
          />
          {errors.employeeNo && (
            <span id="w-empNo-err" role="alert" style={{ fontSize: 12, color: "#b91c1c" }}>
              {errors.employeeNo}
            </span>
          )}
        </div>

        {/* Date of Joining */}
        <div style={fieldWrap}>
          <label htmlFor="w-doj" style={labelStyle}>
            Date of Joining <span style={{ color: "#ef4444" }} aria-hidden="true">*</span>
          </label>
          <input
            id="w-doj"
            type="date"
            value={data.dateOfJoining}
            onChange={(e) => onChange("dateOfJoining", e.target.value)}
            onBlur={() => onBlur("dateOfJoining")}
            aria-required="true"
            aria-invalid={!!errors.dateOfJoining}
            aria-describedby={errors.dateOfJoining ? "w-doj-err" : undefined}
            style={errors.dateOfJoining ? inputErrorStyle : inputStyle}
          />
          {errors.dateOfJoining && (
            <span id="w-doj-err" role="alert" style={{ fontSize: 12, color: "#b91c1c" }}>
              {errors.dateOfJoining}
            </span>
          )}
        </div>

        {/* Department */}
        <div style={fieldWrap}>
          <label htmlFor="w-dept" style={labelStyle}>
            Department <span style={{ color: "#ef4444" }} aria-hidden="true">*</span>
          </label>
          <select
            id="w-dept"
            value={data.departmentId}
            onChange={(e) => onChange("departmentId", e.target.value)}
            onBlur={() => onBlur("departmentId")}
            aria-required="true"
            aria-invalid={!!errors.departmentId}
            aria-describedby={errors.departmentId ? "w-dept-err" : undefined}
            style={errors.departmentId ? inputErrorStyle : inputStyle}
          >
            <option value="">Select department</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
          {errors.departmentId && (
            <span id="w-dept-err" role="alert" style={{ fontSize: 12, color: "#b91c1c" }}>
              {errors.departmentId}
            </span>
          )}
        </div>

        {/* Designation */}
        <div style={fieldWrap}>
          <label htmlFor="w-desig" style={labelStyle}>
            Designation <span style={{ color: "#ef4444" }} aria-hidden="true">*</span>
          </label>
          <select
            id="w-desig"
            value={data.designationId}
            onChange={(e) => onChange("designationId", e.target.value)}
            onBlur={() => onBlur("designationId")}
            aria-required="true"
            aria-invalid={!!errors.designationId}
            aria-describedby={errors.designationId ? "w-desig-err" : undefined}
            style={errors.designationId ? inputErrorStyle : inputStyle}
          >
            <option value="">Select designation</option>
            {designations.map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
          {errors.designationId && (
            <span id="w-desig-err" role="alert" style={{ fontSize: 12, color: "#b91c1c" }}>
              {errors.designationId}
            </span>
          )}
        </div>

        {/* Grade */}
        <div style={fieldWrap}>
          <label htmlFor="w-grade" style={labelStyle}>Pay Grade</label>
          <select
            id="w-grade"
            value={data.grade}
            onChange={(e) => onChange("grade", e.target.value)}
            style={inputStyle}
          >
            <option value="">Select grade</option>
            {GRADES.map((g) => (
              <option key={g} value={g}>{g}</option>
            ))}
          </select>
        </div>

        {/* Employment Type */}
        <div style={fieldWrap}>
          <label htmlFor="w-empType" style={labelStyle}>Employment Type</label>
          <select
            id="w-empType"
            value={data.employeeType}
            onChange={(e) => onChange("employeeType", e.target.value as WizardData["employeeType"])}
            style={inputStyle}
          >
            <option value="permanent">Permanent</option>
            <option value="contractual">Contractual</option>
            <option value="deputation">Deputation</option>
            <option value="apprentice">Apprentice / Trainee</option>
          </select>
        </div>
      </div>
    </>
  );
}
