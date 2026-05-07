# 🚀 Campus Intelligence System

### A data-driven platform for unified campus communication and resource visibility

---

## 📌 Overview

In most campuses, information is scattered across emails, portals, and informal channels like WhatsApp.

Because of this:
- Students miss important announcements  
- Finding classrooms or resources becomes difficult  
- There is no single reliable source of truth  

This system solves that by collecting data from multiple sources and presenting it in a structured and meaningful way.

---

## 🧠 Core Idea

Instead of storing static data, the system works like this:

**Inputs → Processing → Outputs**

- Inputs: emails, notices, user activity  
- Processing: filtering, validation, classification  
- Outputs: structured notices, discussions, resource availability  

---

## 🎯 Use Cases

- Check available classrooms dynamically  
- Automatically view important notices from emails  
- Ask and resolve queries through structured discussions  
- Manage announcements centrally as an admin  

---

## 🔍 Features

- Centralized notice system (admin + email integration)  
- Dynamic classroom/resource availability  
- Structured community discussions with replies and resolution  
- Role-based authentication and session management  
- Automated email fetching using IMAP  

---

## ⚙️ Tech Stack

**Backend:** Node.js, Express.js  
**Database:** MySQL  
**Frontend:** HTML, CSS, JavaScript  
**Mobile (exploration):** Flutter  

---

## 🛠️ Setup Guide

### 1️⃣ Install Requirements

Make sure you have:
- Node.js  
- MySQL  
- MySQL Workbench (optional but recommended)  

---

### 2️⃣ Clone the Project

```bash
git clone http://github.com/Aravind0066/Campus-Platform
cd Campus-Platform
```

---

### 3️⃣ Install Dependencies

```bash
npm install
```

---

### 4️⃣ Setup MySQL Connection

Open MySQL Workbench → Click **"+" (New Connection)** and fill:

- Connection Name: anything (e.g. Campus Intelligence)  
- Hostname: `127.0.0.1`  
- Port: `3306`  
- Username: `root`  
- Password: *(your MySQL password)*  

Click **Test Connection** → then **OK**

---

### 5️⃣ Create Database

Open SQL tab and run:

```sql
CREATE DATABASE myappdb;
```

---

### 6️⃣ Configure Environment Variables

Create a file named `.env` in the project root:

```env
DB_HOST=127.0.0.1
DB_USER=root
DB_PASS=Root@1234
DB_NAME=myappdb
```

> Replace `Root@1234` with your actual MySQL password

---

### 7️⃣ Run Database Migration

```bash
node database/migrate.js
```

This will create all required tables.

---

### 8️⃣ Start the Server

```bash
node server.js
```

---

### 9️⃣ Open the Application

Open your browser and go to:

```
http://localhost:3000
```

---

## 🔑 Default Admin Credentials

```
Email: admin@campus.com
Password: admin123
```

> Change credentials after first login (recommended)

---

## 🏗️ Architecture

```
Data Sources → Processing Engine → Output Layer
```

- Data Sources: users, admins, emails  
- Processing Engine: filtering, validation, classification  
- Output Layer: notices, resources, community  

---

## 🔄 Core Logic

- Resource availability is derived from active notices  
- Notices are filtered by priority and relevance  
- Community posts support replies and accepted answers  
- Update-type posts expire automatically  

---

## 📱 Mobile Extension

A Flutter-based interface fetches notices from backend APIs and displays them in a mobile-friendly format.

---

## 📉 Limitations

- No real-time updates  
- In-memory session storage  
- No pagination for large datasets  

---

## 🚀 Future Improvements

- WebSockets for real-time updates  
- Redis-based session management  
- Advanced search and filtering  
- AI-based classification  
- OAuth authentication  

---

## 💡 Key Insight

> Systems should derive state from data instead of relying on users to maintain it.

---

## 👨‍💻 Author

**Aravind M**

---

## ⚠️ Important Notes

- Do NOT upload `.env` to GitHub  
- Add `.env` to `.gitignore`  
- Ensure MySQL server is running before starting  
