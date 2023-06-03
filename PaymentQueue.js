/*
1. Payment는 Queue에 연결되어 있다.
2. Queue는 DropoffComplete/>를 Topic으로 가지고 있으며,
non-exclusive로 Load-balancing pattern을 구현한다.
이때 payload는 json 형식으로 오며, 여기에는 Timestamp, RIDE-ID, Location의 데이터가 있다.

이 데이터를 받으면, DB에 저장된 자료를 이용, RIDE-ID와 USER-ID, Timestamp를 통해 DB를 검색하여
Cost를 계산 및 증거 자료를 가져온다.

동일한 event가 Company와 indivisualQ에 입력되면, Company에는 message가 쌓이지만,
indivisual은 message를 받고 event를 날려주는 추가 pub가 존재하여, user로 message를 송신한다.

0. 이 작업을 하기 전에, 코드를 수정하여 Ajou msg Callback 을 만들어 topic 및 queue 변화를 만들어야한다.
1. Drop_queue(topic: DropoffComplete/>)을 생성한다.
2. Drop_queue를 Consumer하는 payment를 만든다. (Queue sub)
3. payment는 sub하게 되면, DB에서 data를 가져온다.
4. 가져온 데이터를 근거로, Company Q(User-ID에 따라), indivisualQ에 각각 pub를 한다. (Queue pub)
5. indivisualQ는 user에게 message를 보내야하는 request user를 만들어야한다. 이 기능은 (Queue sub)와,
   (Topic Pub)로 구성되어 있다.
*/

var AjouMSGRecevier = function (solaceModule,sessioninfo) {
  'use strict';
  var solace = solaceModule;
  var ajou = {};
  ajou.session = null;
  ajou.subscribed = false;
  ajou.consuming = false;
  ajou.sessioninfo = sessioninfo;

  // main function 
  ajou.run = function (messageinfo) {
      ajou.type = messageinfo.type;
      ajou.topicName = messageinfo.topic;
      ajou.queueName = messageinfo.queueName;
      ajou.message = messageinfo.message;

      ajou.init();
      ajou.connect();
  };
  //세션 열기
  ajou.init = function (){
      try {
          ajou.session = solace.SolclientFactory.createSession({
              // solace.SessionProperties
              url: ajou.sessioninfo.protocol,
              vpnName: ajou.sessioninfo.vpn,
              userName: ajou.sessioninfo.clientname,
              password: ajou.sessioninfo.password,
          });
      } catch (error) {
          console.log(error.toString());
      }
  };
  // 세션 연결이 완료된 경우
  ajou.connect = function () {
      ajou.session.on(solace.SessionEventCode.UP_NOTICE, function (sessionEvent) {
          console.log('=== Successfully connected and ready to ' + ajou.type  + ' ===');
          //메시지 구독
              //타입: MsgPub, MsgSub, QuePro, QueCom
          if(ajou.type==='MsgSub')
              ajou.subscribe();
          //메시지 전송
          if(ajou.type==='MsgPub'){
              ajou.MessageSend('MsgPub');
              ajou.disconnect();
          }
          //큐 구독
          if(ajou.type==='QueCom')
              ajou.QueueConsume();
          //큐 전송e
          if(ajou.type==='QuePro'){
              ajou.MessageSend('QuePro');
              ajou.disconnect();
          }
      });
      ajou.session.on(solace.SessionEventCode.CONNECT_FAILED_ERROR, function (sessionEvent) {
          console.log('Connection failed to the message router: ' + sessionEvent.infoStr +
              ' - check correct parameter values and connectivity!');
      });
      ajou.session.on(solace.SessionEventCode.DISCONNECTED, function (sessionEvent) {
          console.log('Disconnected.');
          ajou.subscribed = false;
          if (ajou.session !== null) {
              ajou.session.dispose();
              ajou.session = null;
          }
      });
      ajou.session.on(solace.SessionEventCode.SUBSCRIPTION_ERROR, function (sessionEvent) {
          console.log('Cannot subscribe to topic: ' + sessionEvent.correlationKey);
      });
      ajou.session.on(solace.SessionEventCode.SUBSCRIPTION_OK, function (sessionEvent) {
          if (ajou.subscribed) {
              ajou.subscribed = false;
              console.log('Successfully unsubscribed from topic: ' + sessionEvent.correlationKey);
          } else {
              ajou.subscribed = true;
              console.log('Successfully subscribed to topic: ' + sessionEvent.correlationKey);
              console.log('=== Ready to receive messages. ===');
          }
      });
      // define message event listener
      ajou.session.on(solace.SessionEventCode.MESSAGE, function (message) {
          var text = message.getDestination().name.split('/');
          console.log(text);
      });
      // connect the session
      try {
          ajou.session.connect();
      } catch (error) {
          console.log(error.toString());
      }
  };

  // 메시지 받기 (토픽)
  ajou.subscribe = function () {
      if (ajou.session !== null) {
          if (ajou.subscribed) {
              console.log('Already subscribed to "' + ajou.topicName
                  + '" and ready to receive messages.');
          } else {
              console.log('Subscribing to topic: ' + ajou.topicName);
              try {
                  ajou.session.subscribe(
                      solace.SolclientFactory.createTopicDestination(ajou.topicName),
                      true, // generate confirmation when subscription is added successfully
                      ajou.topicName, // use topic name as correlation key
                      10000 // 10 seconds timeout for this operation
                  );
              } catch (error) {
                  console.log(error.toString());
              }
          }
      } else {
          console.log('Cannot subscribe because not connected to Solace PubSub+ Event Broker.');
      }
  };
 //메시지 받기(큐)
  ajou.QueueConsume = function () {
      if (ajou.session !== null) {
          if (ajou.consuming) {
              console.log('Already started consumer for queue "' + ajou.queueName +
                  '" and ready to receive messages.');
          } else {
              console.log('Starting consumer for queue: ' + ajou.queueName);
              try {
                  // Create a message consumer
                  ajou.messageConsumer = ajou.session.createMessageConsumer({
                      // solace.MessageConsumerProperties
                      queueDescriptor: { name: ajou.queueName, type: solace.QueueType.QUEUE },
                      acknowledgeMode: solace.MessageConsumerAcknowledgeMode.CLIENT, // Enabling Client ack
                      createIfMissing: true // Create queue if not exists
                  });
                  // Define message consumer event listeners
                  ajou.messageConsumer.on(solace.MessageConsumerEventName.UP, function () {
                      ajou.consuming = true;
                      console.log('=== Ready to receive messages. ===');
                  });
                  ajou.messageConsumer.on(solace.MessageConsumerEventName.CONNECT_FAILED_ERROR, function () {
                      ajou.consuming = false;
                      console.log('=== Error: the message consumer could not bind to queue "' + ajou.queueName +
                          '" ===\n   Ensure this queue exists on the message router vpn');
                      ajou.exit();
                  });
                  ajou.messageConsumer.on(solace.MessageConsumerEventName.DOWN, function () {
                      ajou.consuming = false;
                      console.log('=== The message consumer is now down ===');
                  });
                  ajou.messageConsumer.on(solace.MessageConsumerEventName.DOWN_ERROR, function () {
                      ajou.consuming = false;
                      console.log('=== An error happened, the message consumer is down ===');
                  });
                  // Define message received event listener
                  ajou.messageConsumer.on(solace.MessageConsumerEventName.MESSAGE, function (message) {
                      var payload = message.getBinaryAttachment().trim()
                      let paydata =  JSON.parse(payload);
                      var queueinfo = {};
                      queueinfo.topic = 'PaymentRequest/' + paydata.UserID +'/' + paydata.RideID;
                      // queueinfo.queueName = business[Number(Math.floor(Math.random()*6))]; //0 ~ 5
                      queueinfo.message = JSON.stringify(paydata); //Cost 및 기타 내용
                      //타입: MsgPub, MsgSub, QuePro, QueCom
                      queueinfo.type = messagetype[0];
                    ajou.run(queueinfo);

                      message.acknowledge();
                  });
                  // Connect the message consumer
                  ajou.messageConsumer.connect();
              } catch (error) {
                  console.log(error.toString());
              }
          }
      } else {
          console.log('Cannot start the queue consumer because not connected to Solace PubSub+ Event Broker.');
      }
  };
 //메시지 전송(큐, 토픽)
  ajou.MessageSend = function (type) {
      if (ajou.session !== null) {
          var message = solace.SolclientFactory.createMessage();
          console.log('Sending message "' + ajou.message + '" to queue "' + ajou.queueName + '"...');
          if(type==='QuePro'){
              message.setDeliveryMode(solace.MessageDeliveryModeType.PERSISTENT);
              message.setDestination(solace.SolclientFactory.createDurableQueueDestination(ajou.queueName));
          }
          if(type==='MsgPub'){
              message.setDeliveryMode(solace.MessageDeliveryModeType.DIRECT);
              message.setDestination(solace.SolclientFactory.createTopicDestination(ajou.topicName));
          }
          message.setBinaryAttachment(ajou.message);
          
          // OPTIONAL: You can set a correlation key on the message and check for the correlation
          // in the ACKNOWLEDGE_MESSAGE callback. Define a correlation key object
          const correlationKey = {
              name: "MESSAGE_CORRELATIONKEY",
              id: Date.now()
          };
          message.setCorrelationKey(correlationKey);

          try {
              // Delivery not yet confirmed. See ConfirmedPublish.js
              ajou.session.send(message);
              console.log('Message sent.');
          } catch (error) {
              console.log(error.toString());
          }
      } else {
          console.log('Cannot send messages because not connected to Solace PubSub+ Event Broker.');
      }
  };

  ajou.exit = function () {
      //타입: MsgPub, MsgSub, QuePro, QueCom
      if(ajou.type==='MsgSub')
          ajou.unsubscribe();
      if(ajou.type==='QueCom')
          ajou.stopConsume();
      ajou.disconnect();
      setTimeout(function () {
          process.exit();
      }, 1000); // wait for 1 second to finish
  };

  // Unsubscribes from topic on Solace PubSub+ Event Broker
  ajou.unsubscribe = function () {
      if (ajou.session !== null) {
          if (ajou.subscribed) {
              console.log('Unsubscribing from topic: ' + ajou.topicName);
              try {
                  ajou.session.unsubscribe(
                      solace.SolclientFactory.createTopicDestination(ajou.topicName),
                      true, // generate confirmation when subscription is removed successfully
                      ajou.topicName, // use topic name as correlation key
                      10000 // 10 seconds timeout for this operation
                  );
              } catch (error) {
                  ajou.log(error.toString());
              }
          } else {
              console.log('Cannot unsubscribe because not subscribed to the topic "'
                  + ajou.topicName + '"');
          }
      } else {
          console.log('Cannot unsubscribe because not connected to Solace PubSub+ Event Broker.');
      }
  };

  ajou.stopConsume = function () {
      if (ajou.session !== null) {
          if (ajou.consuming) {
              ajou.consuming = false;
              console.log('Disconnecting consumption from queue: ' + ajou.queueName);
              try {
                  ajou.messageConsumer.disconnect();
                  ajou.messageConsumer.dispose();
              } catch (error) {
                  console.log(error.toString());
              }
          } else {
              console.log('Cannot disconnect the consumer because it is not connected to queue "' +
              ajou.queueName + '"');
          }
      } else {
          console.log('Cannot disconnect the consumer because not connected to Solace PubSub+ Event Broker.');
      }
  };

  // Gracefully disconnects from Solace PubSub+ Event Broker
  ajou.disconnect = function () {
      console.log('Disconnecting from Solace PubSub+ Event Broker...');
      if (ajou.session !== null) {
          try {
              ajou.session.disconnect();
          } catch (error) {
              console.log(error.toString());
          }
      } else {
          console.log('Not connected to Solace PubSub+ Event Broker.');
      }
  };

  return ajou;
};

var solace = require('solclientjs').debug; // logging supported

const messagetype = ['MsgPub', 'MsgSub', 'QuePro', 'QueCom'];

var connectinfo = {};
  connectinfo.protocol =  'wss://mr-connection-vfpdn26i1ey.messaging.solace.cloud:443';
  connectinfo.clientname = 'solace-cloud-client'; 
  connectinfo.vpn = 'ajou';
  connectinfo.password = 'b4bq602iieoeqn6gsvjriptv8q';

var otherinfo = {};
  otherinfo.protocol =  'wss://mr-connection-vfpdn26i1ey.messaging.solace.cloud:443';
  otherinfo.clientname = 'solace-cloud-client'; 
  otherinfo.vpn = 'ajou';
  otherinfo.password = 'b4bq602iieoeqn6gsvjriptv8q';

var changeinfo = {};
  //MsgPub, MsgSub
  changeinfo.topic = 'DropoffComplete/v1/';
  //QuePro, QueCom
  changeinfo.queueName = 'Individual';//'Dropoff';
  //MsgPub, QuePro
  changeinfo.message = 'init';
  //타입: MsgPub, MsgSub, QuePro, QueCom
  changeinfo.type = messagetype[process.argv.slice(2)[0]];

// Initialize factory with the most recent API defaults
var factoryProps = new solace.SolclientFactoryProperties();
factoryProps.profile = solace.SolclientFactoryProfiles.version10;
solace.SolclientFactory.init(factoryProps);

// enable logging to JavaScript console at WARN level
// NOTICE: works only with ('solclientjs').debug
solace.SolclientFactory.setLogLevel(solace.LogLevel.WARN);

// create the subscriber, specifying the name of the subscription topic
var Ajou = new AjouMSGRecevier(solace,connectinfo);
//var subscriber = new TopicSubscriber(solace, 'taxinyc/ops/ride/updated/v1/enroute/>');

// subscribe to messages on Solace PubSub+ Event Broker
Ajou.run(changeinfo);

// wait to be told to exit
if(changeinfo.type === 'MsgSub' || changeinfo.type === 'QueCom'){
  console.log('Press Ctrl-C to exit');
  process.stdin.resume();
}

process.on('SIGINT', function () {
  'use strict';
  Ajou.exit();
});
