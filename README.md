# Pond Diary

Pond Diary is a Home Assistant add-on for logging water readings, treatments, events, and pond photos. It serves a responsive web interface through Home Assistant Ingress.

## Install in Home Assistant

For a local install, copy the entire [pond_diary](pond_diary) folder into your Home Assistant local add-ons directory. Reload the app store, install **Pond Diary** from the local apps section, and start it. Select **Open Web UI** to use it on desktop or mobile.

For installation from Git, add the repository URL in the Home Assistant app store after the project files have been pushed to the repository.

See the Home Assistant guides for [local apps](https://contributors.home-assistant.io/apps/first-app/) and [Git repositories](https://contributors.home-assistant.io/apps/guides/repository/).

## Water test reminders

1. Update the add-on to version 1.0.2 or later. In its **Configuration** tab, set `reminder_token` to a random string of at least 32 characters, then restart the add-on.
2. Copy [pond_diary_reminder.yaml](home_assistant/pond_diary_reminder.yaml) to the `packages` folder in your Home Assistant configuration directory. Replace the two example `notify.mobile_app_…` actions with the actual phone actions listed in **Developer Tools → Actions**. Add or remove lines for your phones.
3. In Home Assistant's `secrets.yaml`, add these values. Use the same token as in the add-on. The URL below is for a local install. For a repository install, replace `local-pond-diary` with the add-on hostname from its info page or `ha apps info <app-id>`.

   ```yaml
   pond_diary_reminder_url: "http://local-pond-diary:8099/api/reminders/last-water-test"
   pond_diary_reminder_token: "YOUR_RANDOM_TOKEN_HERE"
   ```

4. If packages are new to your setup, add `packages: !include_dir_named packages` under the existing `homeassistant:` section of `configuration.yaml`. Check the configuration and restart Home Assistant.

Home Assistant checks the latest recorded water test at 9:00 a.m. in its configured time zone. It sends a reminder to each phone if 14 full days have elapsed and checks again the next morning. Saving a new test resets the countdown. With no recorded test, no reminder is sent. The read-only endpoint returns just the test timestamp and uses the internal add-on network.

## Run locally

From the repository root with Node.js 24 installed:

```powershell
npm ci --prefix pond_diary
node pond_diary/server.mjs
```

Open [Pond Diary on port 8099](http://127.0.0.1:8099/). The development server listens on loopback and stores its data in `.pond-data/`. Set `PORT` or `DATA_DIR` to use a different port or database directory.

In Home Assistant, the database and photos persist in the add-on's private `/data` directory. Home Assistant handles sign-in through Ingress.
