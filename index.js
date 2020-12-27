// set the path to the environment variables
const envPath = __dirname + "/.env";

// includes dependencies
const slackBots = require("slackbots");
const axios = require("axios");
const dotenv = require("dotenv").config({ path: envPath });
const envfile = require("envfile");
const fs = require("fs");

const projects = JSON.parse(fs.readFileSync(__dirname + "/ci-projects.json"));

// construct the slackbot
const tanuki = new slackBots({
  token: `${process.env.SLACK_BOT_OAUTH_ACCESS_TOKEN}`,
  name: "Tanuki"
});

tanuki.on("start", () => {
  if (process.env.SLACK_BOT_USER_ID == "") {
    tanuki.postMessageToChannel(
      process.env.SLACK_DEFAULT_CHANNEL,
      "Looks like I'm not completely set up, send me a direct message with `@Tanuki`"
    );
  }
});

tanuki.on("message", data => {
  // exclude non-message types and bot messages
  if (data.type !== "message" && data.subtype !== "bot_message") {
    return;
  }

  // direct messages are only for initialisation
  if (data.channel.startsWith("D")) {
    initialise(data);
    return;
  }

  // only react to mentions of the bot user after initialisation
  if (data.text.startsWith("<@" + process.env.SLACK_BOT_USER_ID + ">")) {
    let params = data.text.split(/\b(\w+)\b/g);

    try {
      if (typeof params[2] === "string" && !hasAccess(params[2], data.user)) {
        throw new Error("Authorisation Error");
      }

      if (params[1].includes(":")) {
        parts = params[1].split(":");
        eval(parts[0] + "_" + parts[1])(data, params);
        return;
      }

      eval(params[1])(data);
    } catch (error) {
      errorResponse(error, data);
      return;
    }

    return;
  }
});

const initialise = data => {
  // try and match a user id from the message text
  let userMatch = data.text.match(/^<@.*?>/g);

  if (typeof userMatch != undefined) {
    // read and parse the environment variables
    fs.readFile(envPath, "utf8", (error, data) => {
      if (error) {
        console.error(error);
        return;
      }

      let parsedFile = envfile.parse(data);
      parsedFile.SLACK_BOT_USER_ID = userMatch[0].replace(/[<>@]/g, "");

      // stringify and write the new environment variables to file
      fs.writeFileSync(envPath, envfile.stringify(parsedFile));
    });
  }
};

const hello = data => {
  tanuki.postEphemeral(data.channel, data.user, "Hey there");
};

const job_last = (data, params) => {
  let endpoint = buildUrl(
    "/api/v4/projects/" + projects[params[2]].id + "/jobs"
  );

  if (typeof params[3] == "string") {
    endpoint = endpoint + "&scope[]=" + params[3];
  }

  axios.get(endpoint).then(response => {
    let lastJob = response.data[0];
    let endpoint = buildUrl(
      "/api/v4/projects/" +
        projects[params[2]].id +
        "/jobs/" +
        lastJob.id +
        "/trace"
    );

    axios.get(endpoint).then(response => {
      let logParts = decodeURIComponent(response.data)
        .split("\n")
        .splice(-5);

      tanuki.postMessageToChannel(projects[params[2]].channel, "", {
        mrkdwn: true,
        attachments: [
          {
            color: statusColour(lastJob.status),
            title: "Job - " + lastJob.id,
            title_link: lastJob.web_url,
            mrkdwn_in: ["fields", "text"],
            fields: [
              {
                title: "Name",
                value: lastJob.name,
                short: true
              },
              {
                title: "Stage",
                value: lastJob.stage,
                short: true
              },
              {
                title: "Duration",
                value: Math.round(lastJob.duration) + "s",
                short: true
              },
              {
                title: "Status",
                value: lastJob.status,
                short: true
              },
              {
                title: "Last Commit",
                value:
                  "#" + lastJob.commit.short_id + " - " + lastJob.commit.title,
                short: false
              },
              {
                value: "```" + logParts.join("\n") + "```",
                short: false
              }
            ],
            footer: "GitLab API",
            footer_icon:
              "https://about.gitlab.com/images/press/logo/png/gitlab-icon-rgb.png",
            ts: new Date(lastJob.created_at).getTime() / 1000
          }
        ]
      });
    });
  });
};

const job_retry = (data, params) => {
  let endpoint = buildUrl(
    "/api/v4/projects/" +
      projects[params[2]].id +
      "/jobs/" +
      params[3] +
      "/retry"
  );

  axios.post(endpoint).then(response => {
    tanuki.postEphemeral(data.channel, data.user, "", {
      mrkdwn: true,
      attachments: [
        {
          color: statusColour("success"),
          title: "Job - " + response.data.id,
          title_link: response.data.web_url,
          fields: [
            {
              title: "Name",
              value: response.data.name,
              short: true
            },
            {
              title: "Status",
              value: response.data.status,
              short: true
            },
            {
              title: "Last Commit",
              value:
                "#" +
                response.data.commit.short_id +
                " - " +
                response.data.commit.title,
              short: false
            }
          ],
          footer: "GitLab API",
          footer_icon:
            "https://about.gitlab.com/images/press/logo/png/gitlab-icon-rgb.png",
          ts: new Date(response.data.created_at).getTime() / 1000
        }
      ]
    });
  });
};

const buildUrl = endpoint => {
  return (
    process.env.GITLAB_URL +
    endpoint +
    "?access_token=" +
    process.env.GITLAB_OAUTH_ACCESS_TOKEN
  );
};

const statusColour = status => {
  let colours = {
    success: "#2eb67d",
    failed: "#e01e5a",
    canceled: "#ecb22e"
  };

  return colours[status] != undefined ? colours[status] : "#36C5F0";
};

const hasAccess = (project, slackUserId) => {
  return projects[project].users.includes(slackUserId);
};

const errorResponse = (error, data) => {
  tanuki.postEphemeral(
    data.channel,
    data.user,
    "No such luck - " +
      error +
      "\n" +
      "\n" +
      "`@Tanuki <command>`\n" +
      "\n" +
      "`hello`\n" +
      "`job:last <project> <scope>`\n" +
      "`job:retry <project> <job_id>`"
  );

  return;
};
