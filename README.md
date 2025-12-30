# What is this?

This is a fork of [zen/desktop](https://github.com/zen-browser/desktop) to be api-compatible with electron, but with some key differences.

- It will run as a daemon / singleton (Only starts up once an application requests it, stays open while multiple are running until the last application closes, then closes the daemon)

- Much lower ram / cpu usage for the same end result

Currently, this project renders basic examples & allows CSD/Frameless/Framed windows via the browser console.

This is primarily a POC first & foremost, so, many things are just setup to test/validate & not to be the best possible solution yet.

# How to run

So far, you can run the following to get started;

## First Time (Just cloned / not built firefox)

```sh
# Initialize project for the first time
npm run init

# Import
npm run import

# Build firefox
npm run build

# Starts the project
npm run start
```

## Initialized / Built firefox

```sh
# Import
npm run import

# Build firefox UI
npm run build:ui

# Starts the project
npm run start
```
