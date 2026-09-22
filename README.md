# Campus Marketplace - Backend

The **Campus Marketplace Backend** provides the REST APIs and server-side logic for the Campus Marketplace web and mobile applications.

It handles authentication, users, product listings, search, authorization, and communication with the database and image storage.

## Features

* User registration and login
* JWT-based authentication
* User profile management
* Product listing CRUD operations
* Search and filter functionality
* Listing ownership and authorization
* Product image upload integration
* MongoDB database integration
* REST API

## Tech Stack

* **Runtime:** Node.js
* **Framework:** Express.js
* **Database:** MongoDB
* **Authentication:** JWT
* **Image Storage:** External/Cloud Storage
* **API:** REST API

## Project Structure

```text id="bk92qa"
backend/
├── src/
│   ├── controllers/
│   ├── routes/
│   ├── services/
│   ├── models/
│   ├── middleware/
│   ├── utils/
│   └── config/
├── .env
├── package.json
├── server.js / app.js
└── README.md
```

## Getting Started

### 1. Clone the repository

```bash id="q8r4sx"
git clone <repository-url>
cd backend
```

### 2. Install dependencies

```bash id="f0d6hd"
npm install
```

### 3. Configure Environment

Create a `.env` file:

```env id="h4y8kp"
PORT=5000
MONGODB_URI=<mongodb-connection-string>
JWT_SECRET=<jwt-secret>
IMAGE_STORAGE_URL=<image-storage-url>
```

Do not commit `.env` files or sensitive credentials.

### 4. Run the Server

Development:

```bash id="w5t3nz"
npm run dev
```

Production:

```bash id="k2p7bc"
npm start
```

## API

The backend provides REST APIs used by both the **Web** and **App** repositories.

Main API areas include:

* `/api/auth` — Authentication
* `/api/users` — User management
* `/api/listings` — Product listings

## Project Status

**Status:** In Development

Developed as part of the **OJT Semester 3 — Product Development** project.

COMPLETE PROJECT DOCUMENTATION LINK : https://drive.google.com/file/d/1miNHk4CkprCCCL1-ocQIEOyejaK9Fbui/view?usp=sharing

