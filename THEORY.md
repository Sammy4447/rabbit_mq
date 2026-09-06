# RabbitMQ — Theory Notes

Concepts behind this project, explained from the ground up.

---

## 1. What is a Message Broker?

A **message broker** is a middleman service that sits between two (or more)
applications so they don't have to talk to each other directly.

Without a broker:
```
App A  ────────────────────────────►  App B
       (direct call — both must be
        online at the same time)
```

With a broker:
```
App A  ───►  [ Message Broker ]  ───►  App B
       send            store &            receive
       message         forward            message
```

Why bother with the middleman?
- **Decoupling** — App A doesn't need to know App B's address, or even that
  it exists.
- **Async** — App A can fire a message and move on; it doesn't wait for
  App B to process it.
- **Buffering** — if App B is slow, offline, or crashes, messages just wait
  safely in the broker until it comes back.
- **Scaling** — multiple App B instances can share the work from one queue.

---

## 2. What is RabbitMQ?

**RabbitMQ** is one specific, very popular implementation of a message
broker. It's open-source, written in Erlang, and speaks a protocol called
**AMQP** (see below).

Think of it as a **post office**:
- Senders drop letters (messages) into it.
- It sorts them into the right mailbox (queue).
- Receivers pick up their letters whenever they're ready.

In this project, `rabbitmq` is just a Docker container running the RabbitMQ
server — it's the post office our `producer` and `consumer` talk to.

---

## 3. What is the AMQP Protocol?

**AMQP** = **Advanced Message Queuing Protocol**.

It's the actual network protocol/language that RabbitMQ and its clients
(like the `amqplib` Node.js library we use) speak to each other — similar
to how browsers and web servers speak HTTP.

```
Node.js app  ──(AMQP over TCP, port 5672)──►  RabbitMQ server
   (amqplib)                                  (our docker container)
```

AMQP defines standard concepts everyone agrees on: producers, queues,
consumers, and message acknowledgements. That's exactly what the rest of
this document walks through.

---

## 4. Producer, Consumer, Queue

These are the three basic building blocks of messaging:

| Term | Meaning | In this project |
|---|---|---|
| **Producer** | The app that creates and sends messages | [producer/index.js](producer/index.js) |
| **Queue** | A buffer inside RabbitMQ that holds messages until someone consumes them (FIFO — First In, First Out) | the `"hello"` queue |
| **Consumer** | The app that receives and processes messages | [consumer/index.js](consumer/index.js) |

```
 Producer                     Queue ("hello")                  Consumer
┌──────────┐   sendToQueue   ┌─────────────────┐   consume    ┌──────────┐
│ producer │ ───────────────►│ msg1 msg2 msg3  │─────────────►│ consumer │
└──────────┘                 └─────────────────┘               └──────────┘
```

A queue can hold many messages, and messages wait there until a consumer
is ready to take them — that's the "buffering" benefit from section 1.

---

## 5. Message Acknowledgement (ack)

When a consumer receives a message, RabbitMQ needs to know: *"did you
actually finish processing this, or should I give it to someone else?"*
That's what **acknowledgement (ack)** is for.

Two modes:

- **Auto-ack** (`noAck: true`): RabbitMQ considers the message delivered
  the instant it leaves the queue — even if the consumer crashes right
  after receiving it, the message is gone forever. Fast, but risky.
- **Manual ack** (`noAck: false`, what we use): RabbitMQ keeps the message
  in an "unacknowledged" state until the consumer explicitly calls
  `channel.ack(msg)`. If the consumer disconnects or crashes before
  acking, RabbitMQ **redelivers** the message to another consumer.

```
 Queue                Consumer
┌──────┐   deliver   ┌──────────┐
│ msg1 │────────────►│ process… │
└──────┘             └────┬─────┘
   ▲                      │
   │   ack(msg1)          │  success? ──► channel.ack(msg)   → message removed from queue
   └──────────────────────┤
                           │  crash / no ack? → RabbitMQ redelivers msg1 to another consumer
```

In our [consumer/index.js](consumer/index.js):
```js
channel.consume(QUEUE, (msg) => {
  console.log(`Received: ${msg.content.toString()}`);
  channel.ack(msg); // only after this line does RabbitMQ drop the message
}, { noAck: false });
```

This guarantees **at-least-once delivery** — a message is never silently
lost just because a consumer happened to crash mid-processing.

---

## Putting it all together

```
┌──────────┐                    ┌────────────────────┐                    ┌──────────┐
│ Producer │  sendToQueue       │       RabbitMQ      │      consume       │ Consumer │
│  (AMQP   │───("hello",───────►│  ┌───────────────┐  │───────────────────►│  (AMQP   │
│  client) │    message)        │  │ Queue: "hello"│  │                    │  client) │
└──────────┘                    │  └───────────────┘  │                    └──────────┘
                                 └────────────────────┘                          │
                                          ▲                                      │
                                          └──────────────ack(msg)────────────────┘
```

That's the full round trip this project demonstrates: producer publishes a
message into the `hello` queue → consumer receives it → consumer
acknowledges it, so RabbitMQ knows it's safe to remove from the queue.
