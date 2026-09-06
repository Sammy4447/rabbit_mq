# RabbitMQ + Node.js Docker Example

A minimal, interactive producer/consumer example using RabbitMQ, Node.js, and Docker Compose.

## Structure

```
rabbit/
├── docker-compose.yml
├── producer/   # type a message + Enter, it's sent to the "hello" queue
└── consumer/   # listens on the "hello" queue and prints whatever it receives
```

## Run it (3 terminals)

**Terminal 1 — start RabbitMQ:**
```bash
docker compose up rabbitmq
```
Wait until it logs healthy / "Server startup complete". Management UI: http://localhost:15672 (guest/guest).

**Terminal 2 — start the consumer:**
```bash
docker compose run --rm consumer
```
It will print `[consumer] Waiting for messages...` and sit there listening.

**Terminal 3 — start the producer:**
```bash
docker compose run --rm producer
```
Type a message and press Enter:
```
> hello world
[producer] Sent: hello world
```
Switch to Terminal 2 and you'll see it show up:
```
[consumer] Received: hello world
```

Keep typing in the producer terminal — each line is a new message, instantly shown on the consumer side. Press `Ctrl+C` (or `Ctrl+D`) in either terminal to stop it.

## Stop everything

```bash
docker compose down
```
