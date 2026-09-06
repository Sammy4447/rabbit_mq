# Use a small, official Node.js 20 image (alpine = lightweight Linux) as the base
FROM node:20-alpine

# All following commands run relative to /app inside the container
WORKDIR /app

# Copy only package files first (not the whole app) so Docker can cache the
# npm install layer — it only reruns if package*.json actually changes
COPY package*.json ./
RUN npm install --production

# Now copy the rest of the source code
COPY . .

# Default command when the container starts: run "npm start" (which runs index.js)
CMD ["npm", "start"]
