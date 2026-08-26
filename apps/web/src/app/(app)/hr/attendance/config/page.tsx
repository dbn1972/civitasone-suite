import { PageHeader, Card } from "../../../../_components/ds";

/**
 * Attendance Rules Configuration — defines how the system marks attendance:
 * late, half-day, overtime, weekly-off, flexi-time.
 */
export default function AttendanceConfigPage() {
  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title="Attendance Rules" subtitle="How late marks, half-days, overtime, and weekly-offs are computed (read-only reference)." back="/hr/attendance" backLabel="Attendance" />

      <div className="grid g-2">
        <Card title="Working Hours" padding>
          <table className="tbl" style={{ fontSize: 13 }}>
            <tbody>
              <tr><td>Office start time</td><td><strong>09:30 AM</strong></td></tr>
              <tr><td>Office end time</td><td><strong>06:00 PM</strong></td></tr>
              <tr><td>Grace period (late mark)</td><td><strong>15 minutes</strong></td></tr>
              <tr><td>Half-day cutoff</td><td><strong>After 12:30 PM arrival</strong></td></tr>
              <tr><td>Minimum hours for full day</td><td><strong>7.5 hours</strong></td></tr>
              <tr><td>Weekly off</td><td><strong>Saturday & Sunday</strong></td></tr>
            </tbody>
          </table>
        </Card>

        <Card title="Late Mark Rules" padding>
          <table className="tbl" style={{ fontSize: 13 }}>
            <tbody>
              <tr><td>Grace period</td><td>15 min after start time</td></tr>
              <tr><td>Late mark trigger</td><td>Check-in after 09:45 AM</td></tr>
              <tr><td>Half-day if</td><td>Check-in after 12:30 PM</td></tr>
              <tr><td>Absent if</td><td>No check-in by 02:00 PM</td></tr>
              <tr><td>Late marks → CL deduction</td><td>3 late marks = 1 CL deducted</td></tr>
            </tbody>
          </table>
        </Card>

        <Card title="Overtime Rules" padding>
          <table className="tbl" style={{ fontSize: 13 }}>
            <tbody>
              <tr><td>OT eligible after</td><td>8.5 hours worked</td></tr>
              <tr><td>OT rate (weekday)</td><td>1.5× hourly rate</td></tr>
              <tr><td>OT rate (weekly off / holiday)</td><td>2× hourly rate</td></tr>
              <tr><td>Max OT per day</td><td>4 hours</td></tr>
              <tr><td>Requires approval</td><td>Yes (supervisor)</td></tr>
            </tbody>
          </table>
        </Card>

        <Card title="Compensatory Off (CO)" padding>
          <table className="tbl" style={{ fontSize: 13 }}>
            <tbody>
              <tr><td>Earned when</td><td>Worked on a holiday / weekly off</td></tr>
              <tr><td>Must be availed within</td><td>30 days of earning</td></tr>
              <tr><td>Max accumulation</td><td>3 COs at a time</td></tr>
              <tr><td>Approval required</td><td>Yes (supervisor)</td></tr>
            </tbody>
          </table>
        </Card>
      </div>

      <p style={{ marginTop: 16, color: "var(--mut)", fontSize: 13 }}>
        These rules are applied automatically by the attendance engine when processing daily check-ins. To change them, update via the platform config API.
      </p>
    </main>
  );
}
