async function run() {
  try {
    const res = await fetch("http://localhost:3001/api/icons", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filename: "bridge.svg" }),
    });
    console.log("Status:", res.status);
    const text = await res.text();
    console.log("Response:", text);
  } catch (e) {
    console.error("Error:", e);
  }
}
run();
