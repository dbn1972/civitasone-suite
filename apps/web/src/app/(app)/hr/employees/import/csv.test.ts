import { describe, it, expect } from "vitest";
import { parseCsv } from "./csv";

const cellsOf = (text: string) => parseCsv(text).records.map((r) => r.cells);

describe("parseCsv (GAP-HR-EMPLOYEES-IMPORT-03)", () => {
  it('parses a quoted name with a comma into ONE fullName cell, not two', () => {
    const { records } = parseCsv('employeeNo,fullName,basicPay\nEMP-009,"Das, Rashmi Ranjan",44900\n');
    expect(records[1]?.cells).toEqual(["EMP-009", "Das, Rashmi Ranjan", "44900"]);
    expect(records[1]?.cells).toHaveLength(records[0]?.cells.length ?? -1);
  });

  it("keeps a quoted thousands-separated amount in one cell", () => {
    expect(cellsOf('a,b\nx,"44,900"\n')[1]).toEqual(["x", "44,900"]);
  });

  it('reads "" inside a quoted value as an escaped quote', () => {
    expect(cellsOf('a\n"He said ""hi"""\n')[1]).toEqual(['He said "hi"']);
  });

  it("keeps a line break inside a quoted value in the same cell (the case a split-on-newline reader broke)", () => {
    const { records } = parseCsv('a,b\n"line one\nline two",z\nnext,row\n');
    expect(records.map((r) => r.cells)).toEqual([["a", "b"], ["line one\nline two", "z"], ["next", "row"]]);
  });

  it("reports the physical start line of each record even after a multi-line quoted value", () => {
    const { records } = parseCsv('a,b\n"x\ny",z\nnext,row\n');
    expect(records.map((r) => r.lineNo)).toEqual([1, 2, 4]);
  });

  it("handles CRLF, LF and bare CR line endings", () => {
    expect(cellsOf("a,b\r\n1,2\r\n3,4")).toEqual([["a", "b"], ["1", "2"], ["3", "4"]]);
    expect(cellsOf("a,b\n1,2\n")).toEqual([["a", "b"], ["1", "2"]]);
    expect(cellsOf("a,b\r1,2\r")).toEqual([["a", "b"], ["1", "2"]]);
  });

  it("drops a leading UTF-8 BOM so the first header is not corrupted", () => {
    expect(cellsOf("﻿employeeNo,fullName\nE1,Ravi\n")[0]).toEqual(["employeeNo", "fullName"]);
  });

  it("skips blank lines and trims every cell", () => {
    expect(cellsOf("a, b \n\n   \n 1 ,2\n")).toEqual([["a", "b"], ["1", "2"]]);
  });

  it("keeps empty cells (a short or sparse row is the caller's column-count check, not silently padded here)", () => {
    expect(cellsOf("a,b,c\n1,,3\n4,5\n")).toEqual([["a", "b", "c"], ["1", "", "3"], ["4", "5"]]);
  });

  it("treats a quoted empty value as a real record", () => {
    expect(cellsOf('""\n')).toEqual([[""]]);
  });

  it("flags a quote that is never closed, with the line it opened on, instead of swallowing the rest of the file", () => {
    const r = parseCsv('a,b\n1,"unterminated\n2,3\n');
    expect(r.unterminatedQuoteLine).toBe(2);
  });

  it("reports no unterminated quote for a well-formed file", () => {
    expect(parseCsv('a,b\n"1,2",3\n').unterminatedQuoteLine).toBeNull();
  });

  it("returns no records for empty input", () => {
    expect(parseCsv("").records).toEqual([]);
  });
});
