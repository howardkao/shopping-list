# Shopping List App

A collaborative shopping list app with email authentication, invitation codes, and real-time synchronization.

## Features

- Email/password authentication
- First user automatically becomes admin
- Invitation code system for new users
- Categorized shopping lists
- Check off items as you shop
- Real-time synchronization across devices
- Mobile-friendly responsive design
- Persistent storage with Firebase

## Dependencies

- Node.js (version 16 or higher)
- Firebase account with the following services enabled:
  - Firebase Authentication (Email/Password provider)
  - Firestore Database
  - Realtime Database
  - Firebase Hosting
- npm packages (see package.json)

## Assumptions

- The first user to create an account automatically receives admin privileges
- Admin users can generate invitation codes for new users
- All data is stored in Firebase (Realtime Database for shopping items, Firestore for admin records)
- The app is designed to be deployed on Firebase Hosting
- Authentication is required to access the app
- Users must have a valid invitation code to register (except the first user)

## Project Structure

```
shopping-list-app/
├── src/
│   ├── App.jsx          # Main application component
│   ├── firebase.js      # Firebase configuration
│   ├── main.jsx         # React entry point
│   └── index.css        # Global styles
├── index.html           # HTML template
├── package.json         # Dependencies and scripts
├── vite.config.js       # Vite configuration
├── tailwind.config.js   # Tailwind CSS configuration
├── firebase.json        # Firebase hosting configuration
└── .firebaserc          # Firebase project configuration
```

## Tech Stack

- **Frontend:** React 18
- **Styling:** Tailwind CSS
- **Icons:** Lucide React
- **Build Tool:** Vite
- **Authentication:** Firebase Auth
- **Database:** Firebase Realtime Database + Firestore
- **Hosting:** Firebase Hosting
