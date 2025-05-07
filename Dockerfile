FROM node:16-alpine

WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm install

# Copy the rest of the application
COPY . .

# Expose API and gRPC ports
EXPOSE 3000
EXPOSE 50051

# Set environment variables
ENV NODE_ENV=production

# Start the service
CMD ["node", "src/index.js"] 