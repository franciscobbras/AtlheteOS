# Nexus

Nexus is a web application designed to ingest and synchronize video and ECG data from the Polar H10 heart rate monitor. This application provides a user-friendly interface for uploading data and a dashboard for visualizing the results in sync.

## Features

- Upload videos and ECG data from the Polar H10.
- Dashboard to display synchronized video and ECG data.
- Easy-to-use interface for data management.

## Project Structure

```
nexus
├── public              # Static assets (images, fonts, etc.)
├── src
│   ├── app
│   │   ├── api
│   │   │   ├── upload  # API route for uploading data
│   │   │   └── sync    # API route for syncing data
│   │   ├── dashboard    # Dashboard page component
│   │   ├── upload       # Upload page component
│   │   └── page.tsx     # Main application page
│   ├── components       # Reusable components
│   │   ├── DashboardSync.tsx  # Component for displaying synced data
│   │   ├── UploadForm.tsx      # Form for uploading data
│   │   ├── VideoPlayer.tsx      # Video playback component
│   │   └── PolarECGChart.tsx    # ECG data visualization component
│   ├── lib              # Library files
│   │   ├── supabaseClient.ts  # Supabase client initialization
│   │   └── polarH10.ts        # Utility functions for Polar H10 data
│   ├── hooks             # Custom hooks
│   │   └── useSyncData.ts      # Hook for managing data synchronization
│   └── styles            # CSS styles
│       └── globals.css   # Global styles
├── package.json          # NPM configuration
├── tsconfig.json         # TypeScript configuration
├── next.config.mjs       # Next.js configuration
└── README.md             # Project documentation
```

## Getting Started

To get started with Nexus, follow these steps:

1. Clone the repository:
   ```
   git clone <repository-url>
   cd nexus
   ```

2. Install the dependencies:
   ```
   npm install
   ```

3. Set up your Supabase project and configure the environment variables in `.env.local`.

4. Run the development server:
   ```
   npm run dev
   ```

5. Open your browser and navigate to `http://localhost:3000` to view the application.
### Required Supabase environment variables

```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-public-anon-key
SUPABASE_KEY=your-service-role-or-service-key
# or
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```
## Usage

- Navigate to the **Upload** page to upload your videos and ECG data.
- Use the **Dashboard** to view the synchronized results and videos.

## Deploying to Vercel

1. Push this repository to GitHub.
2. In Vercel, connect your GitHub account and select the `nexus` repository.
3. Use the default build command `npm run build` and the output directory `.next`.
4. Add the following environment variables in Vercel:
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`
   - `SUPABASE_KEY` or `SUPABASE_SERVICE_ROLE_KEY`
5. Deploy the project.

> Use `SUPABASE_KEY` only if you do not have a separate service-role key yet. For better security, use `SUPABASE_SERVICE_ROLE_KEY` on Vercel and keep it private.

## Contributing

Contributions are welcome! Please open an issue or submit a pull request for any enhancements or bug fixes.

## License

This project is licensed under the MIT License. See the LICENSE file for details.