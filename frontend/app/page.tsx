export default function Home() {
  return (
    <main style={{ maxWidth: 720, margin: "40px auto", fontFamily: "system-ui" }}>
      <h1>AI Stock Analyzer</h1>
      <p>Login to analyze a ticker.</p>
      <ul>
        <li><a href="/signup">Sign up</a></li>
        <li><a href="/login">Log in</a></li>
        <li><a href="/dashboard">Dashboard</a></li>
      </ul>
    </main>
  );
}
