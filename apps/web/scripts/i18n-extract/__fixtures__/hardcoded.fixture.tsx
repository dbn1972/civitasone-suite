// Fixture: every string below is a genuine, un-externalized user-facing
// literal the scanner must catch.
export function HardcodedExample() {
  return (
    <div className="wrapper">
      <h1>Welcome to the dashboard</h1>
      <button title="Submit the form" aria-label="Submit the form">
        Submit
      </button>
      <input placeholder="Enter your name" />
      <p>No records found</p>
    </div>
  );
}
