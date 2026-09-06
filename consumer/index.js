const amqp = require("amqplib"); // client library to connect to RabbitMQ and work with queues

// RabbitMQ connection URL. Docker Compose injects this via env var,
// falls back to localhost for running it outside Docker.
const RABBITMQ_URL = process.env.RABBITMQ_URL || "amqp://guest:guest@localhost:5672";
const QUEUE = "hello"; // name of the queue to listen on (must match what the producer uses)

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
      console.log(`[consumer] RabbitMQ not ready (attempt ${i}/${retries}): ${err.message}`);
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

  console.log("[consumer] Waiting for messages...");

  // register a listener on the queue — this callback fires for every new message
  channel.consume(
    QUEUE,
    (msg) => {
      if (msg !== null) {
        // msg.content is a Buffer, so convert it to a string to display it
        console.log(`[consumer] Received: ${msg.content.toString()}`);
        // ack() tells RabbitMQ the message was handled, so it can remove it from the queue.
        // Without this, RabbitMQ would redeliver it (e.g. if the consumer crashed).
        channel.ack(msg);
      }
    },
    { noAck: false } // false = we manually ack messages (auto-ack disabled)
  );

  // on Ctrl+C (SIGINT), close everything cleanly before exiting
  process.on("SIGINT", async () => {
    await channel.close();
    await connection.close();
    process.exit(0);
  });
}

// run main(); if anything fails (e.g. connection never succeeds), log it
// and exit with a non-zero code
main().catch((err) => {
  console.error("[consumer] Fatal error:", err);
  process.exit(1);
});
