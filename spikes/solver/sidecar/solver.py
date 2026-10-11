#!/usr/bin/env python3
"""
solver.py — the OR-Tools CP-SAT sidecar for ST-M01-13 (candidate per D-ST-05(b)).

Reads a SidecarRequest JSON on stdin, solves each partition's max-weight
assignment with CP-SAT, writes a SidecarResponse JSON on stdout. The TS adapter
(cpsat.ts) owns scoring, hashing and hard-feasibility; this process only returns
the chosen (employeeId, positionId) pairs. CP-SAT is given the SAME pre-scaled
integer edge weights the baseline uses, so its optimum coincides with the
baseline's and the plan hash matches.

Determinism: single worker, fixed random seed, and we maximise the exact integer
objective, which has a unique optimum thanks to the TS-side tie-break scaling.
"""
import json
import sys

from ortools.sat.python import cp_model


def solve_partition(part):
    employees = part["employees"]
    positions = part["positions"]
    edges = part["edges"]  # list of [i, j, score]

    model = cp_model.CpModel()
    # x[(i, j)] = 1 iff employee i -> position j.
    x = {}
    by_emp = {}
    by_pos = {}
    obj_terms = []
    for i, j, score in edges:
        v = model.NewBoolVar(f"x_{i}_{j}")
        x[(i, j)] = v
        by_emp.setdefault(i, []).append(v)
        by_pos.setdefault(j, []).append((v, j))
        obj_terms.append(score * v)

    # Each employee at most one position.
    for i, vs in by_emp.items():
        model.Add(sum(vs) <= 1)
    # Each position up to its capacity.
    cap = {j: positions[j]["capacity"] for j in range(len(positions))}
    for j, vs in by_pos.items():
        model.Add(sum(v for (v, _jj) in vs) <= cap[j])

    model.Maximize(sum(obj_terms))

    solver = cp_model.CpSolver()
    solver.parameters.num_search_workers = 1
    solver.parameters.random_seed = 1
    solver.parameters.max_time_in_seconds = part.get("time_budget_s", 900)
    status = solver.Solve(model)

    out = []
    if status in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        for (i, j), v in x.items():
            if solver.Value(v) == 1:
                eid = employees[i]["id"]
                pid = positions[j]["id"]
                out.append((eid, pid))
    return out


def main():
    req = json.load(sys.stdin)
    assignments = []
    for part in req["partitions"]:
        assignments.extend(solve_partition(part))
    json.dump({"assignments": assignments}, sys.stdout)


if __name__ == "__main__":
    main()
