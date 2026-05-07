🚀 Campus Intelligence System

A data-driven platform for unified campus communication and resource visibility.

📌 Overview

In most campuses, information is scattered across emails, portals, and informal channels like WhatsApp.

Because of this:

Students miss important announcements
Finding classrooms or resources becomes difficult
There is no single reliable source of truth

This system solves that by collecting data from multiple sources and presenting it in a structured and meaningful way.

🧠 Core Idea

Instead of storing static data, the system works like this:

Inputs → Processing → Outputs

Inputs: emails, notices, user activity
Processing: filtering, validation, classification
Outputs: structured notices, discussions, resource availability

The system automatically derives information instead of relying on manual updates.

🎯 Use Cases
Students check available classrooms in real time
Important notices are automatically fetched from emails
Students ask questions and get structured answers
Admin manages all announcements in one place
🔍 Features
Centralized notice system (admin + email integration)
Dynamic classroom/resource availability
Structured community discussions with replies and resolution
Role-based authentication and session management
Automated email fetching using IMAP
⚙️ Tech Stack

Backend: Node.js, Express.js
Database: MySQL
Frontend: HTML, CSS, JavaScript
Mobile (exploration): Flutter

🛠️ Complete Setup Guide (Step-by-Step)
Step 1 — Install Requirements

Make sure you have:

Node.js installed
MySQL installed
MySQL Workbench (optional but recommended)
Step 2 — Clone the Project
git clone <your-repo-link>
cd Campus-Platform
Step 3 — Install Dependencies
npm install
Step 4 — Setup MySQL (Database + Connection)
Open MySQL Workbench
Click "+" (New Connection)
Fill the following:
Connection Name: anything (e.g. Campus Intelligence)
Hostname: 127.0.0.1
Port: 3306
Username: root
Password: your MySQL password
Click Test Connection → then OK
Step 5 — Create Database

Open a new SQL tab and run:

CREATE DATABASE myappdb;
Step 6 — Configure Environment Variables

Create a file named .env in the project root:

DB_HOST=127.0.0.1
DB_USER=root
DB_PASS=Root@1234
DB_NAME=myappdb

⚠️ Replace Root@1234 with your actual MySQL password

Step 7 — Run Database Migration

This creates all required tables automatically:

node database/migrate.js

After this, you should see tables appear in MySQL Workbench.

Step 8 — Start the Server
node server.js
Step 9 — Open the Application

Open your browser and go to:

http://localhost:3000
🔑 Default Admin Login

Use this to log in:

Email: admin@campus.com

Password: admin123

⚠️ Change this after first login

🏗️ Architecture (Simple Explanation)

The system has 3 main parts:

Data Sources
(users, admin inputs, emails)
Processing Engine
(filters and processes data)
Output Layer
(what users see: notices, resources, discussions)
🔄 Core Logic
Resource availability is based on active notices
Notices are filtered by priority and relevance
Community posts allow replies and accepted answers
Some posts expire automatically to avoid clutter
📱 Mobile Extension

A Flutter-based mobile interface fetches notices from backend APIs and displays them in a simple format.

📉 Limitations
No real-time updates
In-memory session storage
No pagination for large data
🚀 Future Improvements
Real-time updates using WebSockets
Redis-based session storage
Advanced search and filtering
AI-based classification
OAuth authentication
💡 Key Insight

Users do not reliably maintain system state.
The system must derive state from data.

👨‍💻 Author

Aravind M
