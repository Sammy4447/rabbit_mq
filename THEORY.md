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

AMQP defines standard concepts everyone agrees on: connections, channels,
exchanges, queues, bindings, and message acknowledgements. That's exactly
what the rest of this document walks through.

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

## 5. Connection & Channel

These are two different levels of "being connected" to RabbitMQ.

- **Connection**: a real TCP socket between your app and the RabbitMQ
  server. Expensive to create/destroy, so you normally open just **one**
  per app.
- **Channel**: a lightweight "virtual connection" that lives *inside* a
  connection. All the real work (publishing, consuming, declaring queues)
  happens on a channel, not directly on the connection.

```
┌─────────────────────────── Connection (TCP) ───────────────────────────┐
│                                                                         │
│   ┌───────────┐        ┌───────────┐        ┌───────────┐              │
│   │ Channel 1 │        │ Channel 2 │        │ Channel 3 │   ...        │
│   └───────────┘        └───────────┘        └───────────┘              │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

Why bother with channels instead of just using the connection directly?
Opening a new TCP connection is costly, but opening a new channel is
cheap — so an app with many concurrent tasks can multiplex them over a
handful of channels instead of many connections.

In our code:
```js
const connection = await amqp.connect(RABBITMQ_URL); // one TCP connection
const channel = await connection.createChannel();    // one channel on it
```

---

## 6. Exchanges & Types

Here's the part that's easy to miss when you're just doing
`sendToQueue()`: **a producer never actually sends directly to a queue.**
It sends to an **exchange**, and the exchange decides which queue(s) the
message ends up in.

```
                         ┌───────────┐
Producer ───publish───► │ Exchange  │ ───routes to───► Queue(s) ───► Consumer
                         └───────────┘
```

`channel.sendToQueue(QUEUE, ...)` (used in this project) is actually a
convenience shortcut that publishes to RabbitMQ's built-in **default
exchange** (an empty-string-named, unnamed exchange) using the queue name
as the routing key. Under the hood it's still "publish to an exchange."

There are 4 standard exchange types, each with different routing logic:

### a) Direct
Routes a message to the queue(s) whose **binding key** exactly matches the
message's **routing key**.
```
                     routing key = "error"
Producer ──publish──────────────────────► [ Direct Exchange ]
                                              │            │
                                     binding: "error"  binding: "info"
                                              │            │
                                              ▼            ▼
                                        [ Queue A ]   [ Queue B ]
                                        (gets it)     (doesn't)
```

### b) Fanout
Ignores routing keys completely — broadcasts every message to **all**
bound queues. Used for pub/sub-style broadcast.
```
Producer ──publish──► [ Fanout Exchange ]
                          │      │      │
                          ▼      ▼      ▼
                      Queue A  Queue B  Queue C
                      (all get a copy)
```

### c) Topic
Like Direct, but routing/binding keys support wildcard patterns
(`*` = one word, `#` = zero or more words). E.g. a binding of
`"logs.*.error"` matches routing key `"logs.app.error"`.
```
routing key: "logs.payment.error"
                     │
                     ▼
             [ Topic Exchange ]
              /              \
   binding: "logs.*.error"   binding: "logs.payment.#"
              │                          │
              ▼                          ▼
          Queue A (match)            Queue B (match)
```

### d) Headers
Routes based on message header attributes instead of the routing key at
all (rarely used in practice) — not covered further here.

**In this project** we only use the default exchange with `sendToQueue`,
which is the simplest possible case: one producer, one queue, one
consumer — no fancy routing needed. Exchanges matter once you have
multiple queues/consumers that should each get different messages.

---

## 7. Binding & Routing Key

- **Routing key**: a label the *producer* attaches to a message when
  publishing (e.g. `"error"`, `"logs.payment.error"`).
- **Binding**: a *link* you create between an exchange and a queue, with a
  binding key that says "send me messages whose routing key matches this."

```
Queue.bind(exchange, bindingKey)
        │
        ▼
[ Exchange ] ──message with routing key "X"──► matches binding "X"? ──► goes into Queue
```

Analogy: think of routing key as the **address written on an envelope**,
and binding as **telling the post office "any mail addressed like this
should go to my mailbox."** The exchange is the sorting machine that reads
the address and applies your rule.

With the default exchange + `sendToQueue(queueName, ...)`, RabbitMQ
auto-creates an implicit binding where the binding key = the queue name,
so every queue is automatically reachable by its own name. That's why we
don't have to manually declare exchanges/bindings in this simple example.

---

## 8. Message Acknowledgement (ack)

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
┌──────────┐                 ┌───────────────────────────────┐              ┌──────────┐
│ Producer │                 │           RabbitMQ            │              │ Consumer │
│          │   connection    │  ┌──────────┐                 │  connection  │          │
│  (AMQP   │◄───────────────►│  │ Exchange │──binding/routing│◄────────────►│  (AMQP   │
│  client) │   + channel     │  └────┬─────┘   key───────┐   │  + channel   │  client) │
└──────────┘                 │       │                   │   │              └──────────┘
     │                       │       ▼                   ▼   │                   │
     │  sendToQueue("hello",  │  ┌─────────────┐               │   consume("hello") │
     └──publish message)────►│  │ Queue: hello │──────────────►│───ack(msg)────────┘
                              │  └─────────────┘               │
                              └───────────────────────────────┘
```

That's the full round trip this project demonstrates: producer publishes →
default exchange routes it into the `hello` queue → consumer receives it →
consumer acknowledges it.
