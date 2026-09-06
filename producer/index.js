const amqp = require("amqplib"); // client library to connect to RabbitMQ and publish messages
const readline = require("readline"); // reads typed terminal input line-by-line

// RabbitMQ connection URL. Docker Compose injects this via env var,
// falls back to localhost for running it outside Docker.
const RABBITMQ_URL = process.env.RABBITMQ_URL || "amqp://guest:guest@localhost:5672";
const QUEUE = "hello"; // name of the queue to publish to (must match what the consumer listens on)

// The RabbitMQ container might still be starting up (in docker-compose),
// so a direct connect() can fail. This retries with a delay until it
// succeeds or we run out of attempts.
async function connectWithRetry(retries = 10, delayMs = 3000) {
  for (let i = 1; i <= retries; i++) {
    try {
      const connection = await amqp.connect(RABBITMQ_URL);
      return connection; // connected successfully
    } catch (err) {
      // not ready yet — log and wait before trying again
      console.log(`[producer] RabbitMQ not ready (attempt ${i}/${retries}): ${err.message}`);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  // ran out of retries — no point continuing
  throw new Error("Could not connect to RabbitMQ after multiple retries");
}

async function main() {
  // connect to RabbitMQ (with retry logic above)
  const connection = await connectWithRetry();
  // a channel is the actual pipe used to publish/consume messages
  const channel = await connection.createChannel();

  // "assert" the queue: creates it if it doesn't exist, no-ops if it does.
  // Producer and consumer must both declare it the same way (durable: false here).
  await channel.assertQueue(QUEUE, { durable: false });

  console.log("[producer] Connected! Type a message and press Enter to send it (Ctrl+C to quit).");

  // readline reads terminal input for us — whatever the user types and hits
  // Enter on shows up in the "line" event below
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  rl.setPrompt("> "); // show a "> " prompt so it's clear we're waiting for input
  rl.prompt();

  // fires every time the user types a line and presses Enter
  rl.on("line", (line) => {
    const message = line.trim(); // strip extra whitespace
    if (message.length > 0) {
      // send the message to the queue; amqplib expects a Buffer, so convert the string
      channel.sendToQueue(QUEUE, Buffer.from(message));
      console.log(`[producer] Sent: ${message}`);
    }
    rl.prompt(); // show the prompt again for the next message
  });

  // fires when readline closes (Ctrl+C / Ctrl+D) — close everything cleanly
  rl.on("close", async () => {
    await channel.close();
    await connection.close();
    process.exit(0);
  });
}

// run main(); if anything fails (e.g. connection never succeeds), log it
// and exit with a non-zero code
main().catch((err) => {
  console.error("[producer] Fatal error:", err);
  process.exit(1);
});
