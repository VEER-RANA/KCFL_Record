# Card Game Manager

A MERN starter for managing a trick-taking card game with live scoring, bidding, and super-player controls.

## Stack

- Client: React, Vite, TypeScript, Socket.IO client
- Server: Node.js, Express, TypeScript, MongoDB, Mongoose, Socket.IO
- Shared patterns: Zod validation and typed request/response payloads

## Scripts

- `npm run dev` - run client and server together
- `npm run build` - build both apps
- `npm run start` - start the server
- `npm run lint` - run lint tasks for both apps

## Next Steps

The current scaffold includes the app shells, the game data model, and the realtime contract. The next implementation pass should connect the frontend forms to the API and persist rooms in MongoDB.
