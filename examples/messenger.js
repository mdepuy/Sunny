'use strict';

// Messenger API integration example
// We assume you have:
// * a Wit.ai bot setup (https://wit.ai/docs/quickstart)
// * a Messenger Platform setup (https://developers.facebook.com/docs/messenger-platform/quickstart)
// You need to `npm install` the following dependencies: body-parser, express, request.
//
// 1. npm install body-parser express request
// 2. Download and install ngrok from https://ngrok.com/download
// 3. ./ngrok http 8445
// 4. WIT_TOKEN=your_access_token FB_PAGE_ID=your_page_id FB_PAGE_TOKEN=your_page_token FB_VERIFY_TOKEN=verify_token node examples/messenger.js
// 5. Subscribe your page to the Webhooks using verify_token and `https://<your_ngrok_io>/fb` as callback URL.
// 6. Talk to your bot on Messenger!

const bodyParser = require('body-parser');
const express = require('express');
const request = require('request');

// When not cloning the `node-wit` repo, replace the `require` like so:
// const Wit = require('node-wit').Wit;
const Wit = require('../').Wit;

// Webserver parameter
const PORT = process.env.PORT || 8445;

// Wit.ai parameters
const WIT_TOKEN = process.env.WIT_TOKEN;

// Messenger API parameters
const FB_PAGE_ID = process.env.FB_PAGE_ID && Number(process.env.FB_PAGE_ID);
if (!FB_PAGE_ID) {
  throw new Error('missing FB_PAGE_ID');
}
const FB_PAGE_TOKEN = process.env.FB_PAGE_TOKEN;
if (!FB_PAGE_TOKEN) {
  throw new Error('missing FB_PAGE_TOKEN');
}
const FB_VERIFY_TOKEN = process.env.FB_VERIFY_TOKEN;

// See the Webhook reference
// https://developers.facebook.com/docs/messenger-platform/webhook-reference
const getFirstMessagingEntry = (body) => {
  const val = body.object == 'page' &&
    body.entry &&
    Array.isArray(body.entry) &&
    body.entry.length > 0 &&
    body.entry[0] &&
    body.entry[0].id == FB_PAGE_ID &&
    body.entry[0].messaging &&
    Array.isArray(body.entry[0].messaging) &&
    body.entry[0].messaging.length > 0 &&
    body.entry[0].messaging[0]
  ;
  return val || null;
};

// Wit.ai bot specific code

// This will contain all user sessions.
// Each session has an entry:
// sessionId -> {fbid: facebookUserId, context: sessionState}
const sessions = {};

const findOrCreateSession = (fbid) => {
  let sessionId;
  // Let's see if we already have a session for the user fbid
  Object.keys(sessions).forEach(k => {
    if (sessions[k].fbid === fbid) {
      // Yep, got it!
      sessionId = k;
    }
  });
  if (!sessionId) {
    // No session found for user fbid, let's create a new one
    sessionId = new Date().toISOString();
    sessions[sessionId] = {fbid: fbid, context: {}};
  }
  return sessionId;
};

const firstEntityValue = (entities, entity) => {
  const val = entities && entities[entity] &&
    Array.isArray(entities[entity]) &&
    entities[entity].length > 0 &&
    entities[entity][0].value
  ;
  if (!val) {
    return null;
  }
  return typeof val === 'object' ? val.value : val;
};

// Our bot actions
const actions = {
  say(sessionId, context, message, cb) {
    // Our bot has something to say!
    // Let's retrieve the Facebook user whose session belongs to
    const recipientId = sessions[sessionId].fbid;
    if (recipientId) {
      // Yay, we found our recipient!
      // Let's forward our bot response to her.
      fbMessage(recipientId, message, (err, data) => {
        if (err) {
          console.log(
            'Oops! An error occurred while forwarding the response to',
            recipientId,
            ':',
            err
          );
        }

        // Let's give the wheel back to our bot
        cb();
      });
    } else {
      console.log('Oops! Couldn\'t find user for session:', sessionId);
      // Giving the wheel back to our bot
      cb();
    }
  },
  merge(sessionId, context, entities, message, cb) {
    console.log(context);
    cb(context);
  },
  error(sessionId, context, error) {
    console.log(error.message);
  },
  lookup_tonights_schedule(sessionId, context, cb) {
    cb(context);
  },
  list_schedule(sessionId, context, cb) {
    const recipientId = sessions[sessionId].fbid;
    fbCarousel(recipientId);
    cb(context);
  },
  set_reminder(sessionId, context, cb) {
    const recipientId = sessions[sessionId].fbid;
    console.log('set reminder...');
    console.log(context);
    cb(context);
  }
};

// Setting up our bot
const wit = new Wit(WIT_TOKEN, actions);

// Starting our webserver and putting it all together
const app = express();
app.set('port', PORT);
app.listen(app.get('port'));
app.use(bodyParser.json());

// Webhook setup
app.get('/fb', (req, res) => {
  if (!FB_VERIFY_TOKEN) {
    throw new Error('missing FB_VERIFY_TOKEN');
  }
  if (req.query['hub.mode'] === 'subscribe' &&
    req.query['hub.verify_token'] === FB_VERIFY_TOKEN) {
    res.send(req.query['hub.challenge']);
  } else {
    res.sendStatus(400);
  }
});

// Message handler
app.post('/fb', (req, res) => {
  // Parsing the Messenger API response
  const messaging = getFirstMessagingEntry(req.body);
  if (messaging && (messaging.message || messaging.postback) && messaging.recipient.id === FB_PAGE_ID) {
    // Yay! We got a new message!

    // We retrieve the Facebook user ID of the sender
    const sender = messaging.sender.id;

    // We retrieve the user's current session, or create one if it doesn't exist
    // This is needed for our bot to figure out the conversation history
    const sessionId = findOrCreateSession(sender);

    // We retrieve the message content
    const msg = messaging.postback ? messaging.postback.payload : messaging.message.text;
    const atts = messaging.message ? messaging.message.attachments : null;

    if (atts) {
      // We received an attachment

      // Let's reply with an automatic message
      fbMessage(
        sender,
        'Sorry I can only process text messages for now.'
      );
    } else if (msg) {
      console.log("message: ");
      console.log(msg);
      // We received a text message

      // Let's forward the message to the Wit.ai Bot Engine
      // This will run all actions until our bot has nothing left to do
      wit.runActions(
        sessionId, // the user's current session
        msg, // the user's message
        sessions[sessionId].context, // the user's current session state
        (error, context) => {
          if (error) {
            console.log('Oops! Got an error from Wit:', error);

            fbMessage(
              sender,
              'Oops! Got an error from Wit'
            );
          } else {
            // Our bot did everything it has to do.
            // Now it's waiting for further messages to proceed.
            console.log('Waiting for futher messages.');

            // Based on the session state, you might want to reset the session.
            // This depends heavily on the business logic of your bot.
            // Example:
            // if (context['done']) {
            //   delete sessions[sessionId];
            // }

            // Updating the user's current session state
            sessions[sessionId].context = context;
          }
        }
      );
    }
  }
  res.sendStatus(200);
});


// Messenger API specific code

// See the Send API reference
// https://developers.facebook.com/docs/messenger-platform/send-api-reference
const fbReq = request.defaults({
  uri: 'https://graph.facebook.com/me/messages',
  method: 'POST',
  json: true,
  qs: { access_token: FB_PAGE_TOKEN },
  headers: {'Content-Type': 'application/json'},
});

const fbMessage = (recipientId, msg, cb) => {
  const opts = {
    form: {
      recipient: {
        id: recipientId,
      },
      message: {
        text: msg,
      },
    },
  };
  fbReq(opts, (err, resp, data) => {
    if (cb) {
      cb(err || data.error && data.error.message, data);
    }
  });
};

const fbImage = (recipientId, cb) => {
  const opts = {
    form: {
      recipient: {
        id: recipientId,
      },
      message: {
       attachment:{
         type:"image",
         payload:{
           "url":"http://images.amcnetworks.com/sundancechannel.com/wp-content/uploads/2015/06/1-Hap-and-Leonard-Nav-KeyArt-800x450-314x174.jpg"
         }
       }
     },
    },
  };
  fbReq(opts, (err, resp, data) => {
    if (cb) {
      cb(err || data.error && data.error.message, data);
    }
  });
};

const fbCarousel = (recipientId, cb) => {
  const opts = {
    form: {
      recipient: {
        id: recipientId,
      },
        "message":{
          "attachment":{
            "type":"template",
            "payload":{
              "template_type":"generic",
              "elements":[
                {
                  "title":"7:30PM ET - The Bone Collector",
                  "image_url":"http://images.amcnetworks.com/sundancechannel.com/wp-content/uploads/2016/04/The-Bone-Collector-700x384-700x384.jpg",
                  "subtitle":"A quadriplegic detective (Denzel Washington) and a patrol cop (Angelina Jolie) try to catch a killer re-creating grisly crimes.",
                  "buttons":[
                    {
                      "type":"web_url",
                      "url":"http://www.sundance.tv/films/the-bone-collector",
                      "title":"More Info"
                    },
                    {
                      "type":"postback",
                      "title":"Set Reminder",
                      "payload":"Set reminder for The Bone Collector"
                    }
                  ]
                },
                {
                  "title":"10:00PM ET - The Last Panthers",
                  "image_url":"http://images.amcnetworks.com/sundancechannel.com/wp-content/uploads/2016/04/The-Last-Panthers-Episode-104-Serpents-Kiss800x450-700x384.jpg",
                  "subtitle":"Episode 4: Serpent's Kiss",
                  "buttons":[
                    {
                      "type":"web_url",
                      "url":"http://www.sundance.tv/series/the-last-panthers/episodes/season-1/serpents-kiss",
                      "title":"More Info"
                    },
                    {
                      "type":"postback",
                      "title":"Set Reminder",
                      "payload":"Set reminder for The Last Panthers"
                    }
                  ]
                },
                {
                  "title":"11:10PM - Breaking Bad",
                  "image_url":"http://images.amcnetworks.com/sundancechannel.com/wp-content/uploads/2013/02/breaking-bad-280x160.jpg",
                  "subtitle":"Pilot",
                  "buttons":[
                    {
                      "type":"web_url",
                      "url":"http://www.sundance.tv/series/breaking-bad",
                      "title":"More Info"
                    },
                    {
                      "type":"postback",
                      "title":"Set Reminder",
                      "payload":"Set reminder for Breaking Bad"
                    }
                  ]
                }
              ]
            }
          }
        },
    },
  };
  fbReq(opts, (err, resp, data) => {
    if (cb) {
      cb(err || data.error && data.error.message, data);
    }
  });
};