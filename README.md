🚀 Campus Intelligence System

A data-driven platform for unified campus communication and resource visibility.

📌 Overview
Campus information is often fragmented across emails, portals, and informal channels.
Students miss important announcements and struggle to find classrooms or resources.

This system solves that by centralizing data and transforming it into structured, actionable information.

🧠 Core Idea
Instead of treating data as static, the system follows:

Inputs → Processing → Outputs

Inputs: emails, notices, user activity
Processing: classification, filtering, validation
Outputs: structured notices, discussions, resource availability

🎯 Use Cases
A student checks available classrooms without relying on manual updates
Important notices are automatically fetched from email and displayed
Students ask questions and get structured, trackable answers
Admins manage announcements in a centralized system

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

🏗️ Architecture
Data Sources (users, admins, emails)
Processing Engine (classification, filtering, validation)
Output Layer (UI for notices, resources, discussions)

🔄 Core Logic
Resource availability is determined using active notices
Notices are filtered by priority and relevance
Community posts support replies and accepted answers
Update-type posts expire automatically

📱 Mobile Extension
A Flutter-based interface fetches notices from backend APIs to provide a simple mobile experience.

🛠️ How to Run
Clone the repository
Install dependencies:
npm install
Configure environment variables:
DB_HOST
DB_USER
DB_PASS
DB_NAME
Start the server:
node app.js
Open in browser:
http://localhost:3000

📁 Project Structure
/backend → server, routes, logic
/frontend → UI pages and scripts
/database → schema and queries

📉 Limitations
No real-time updates
In-memory session storage
No pagination for large datasets

🚀 Future Improvements
WebSockets for real-time updates
Redis-based session storage
Advanced search and filtering
AI-based classification
OAuth authentication

💡 Key Insight
Users do not reliably maintain system state.
The system must derive state from data.

👨‍💻 Author
Aravind M
