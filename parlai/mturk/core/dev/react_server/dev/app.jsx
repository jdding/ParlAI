/*
 * Copyright (c) 2017-present, Facebook, Inc.
 * All rights reserved.
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree. An additional grant
 * of patent rights can be found in the PATENTS file in the same directory.
 */

import React from 'react';
import ReactDOM from 'react-dom';
import {
  BaseFrontend,
  StaticFrontend,
  setCustomComponents,
} from './components/core_components.jsx';
import BuiltCustomComponents from 'custom_built_frontend';
import CustomComponents from './components/custom.jsx';
import SocketHandler from './components/socket_handler.jsx';
import {
  MTurkSubmitForm,
  allDoneCallback,
  staticAllDoneCallback,
} from './components/mturk_submit_form.jsx';
import 'fetch';
import $ from 'jquery';

var UseCustomComponents = {};
if (Object.keys(BuiltCustomComponents).length) {
  UseCustomComponents = BuiltCustomComponents;
} else if (Object.keys(CustomComponents).length) {
  UseCustomComponents = CustomComponents;
}

setCustomComponents(UseCustomComponents);

/* ================= Utility functions ================= */

// Determine if the browser is a mobile phone
function isMobile() {
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
    navigator.userAgent
  );
}

// Sends a request to get the hit_config
function getHitConfig(callback_function) {
  $.ajax({
    url: '/get_hit_config',
    timeout: 3000, // in milliseconds
  }).then(function(data) {
    if (callback_function) {
      callback_function(data);
    }
  });
}

// Sees if the current browser supports WebSockets, using *bowser*
/* global bowser */
// TODO import bowser as a regular dependency, rather than in the static html
function doesSupportWebsockets() {
  return !(
    (bowser.msie && bowser.version < 10) ||
    (bowser.firefox && bowser.version < 11) ||
    (bowser.chrome && bowser.version < 16) ||
    (bowser.safari && bowser.version < 7) ||
    (bowser.opera && bowser.version < 12.1)
  );
}

/* ================= Agent State Constants ================= */

// TODO move to shared file
const STATUS_NONE = 'none';
const STATUS_ONBOARDING = 'onboarding';
const STATUS_WAITING = 'waiting';
const STATUS_IN_TASK = 'in task';
const STATUS_DONE = 'done';
const STATUS_DISCONNECT = 'disconnect';
const STATUS_PARTNER_DISCONNECT = 'partner disconnect';
const STATUS_STATIC = 'static';
const STATUS_EXPIRED = 'expired';
const STATUS_RETURNED = 'returned';
const STATUS_PARLAI_DISCONNECT = 'parlai_disconnect';

/* ================= Application Components ================= */

/* global
  FRAME_HEIGHT, HIT_ID, ASSIGNMENT_ID, WORKER_ID, TEMPLATE_TYPE, BLOCK_MOBILE,
  DISPLAY_FEEDBACK, IS_COVER_PAGE
*/

// TODO move this magic constant somewhere
const DEFAULT_FRAME_HEIGHT = 650;

class MainApp extends React.Component {
  constructor(props) {
    super(props);
    let initialization_status = 'initializing';
    if (!doesSupportWebsockets()) {
      initialization_status = 'websockets_failure';
    }

    // TODO move constants to props rather than state
    this.state = {
      task_description: null,
      mturk_submit_url: null,
      frame_height: FRAME_HEIGHT,
      socket_status: null,
      hit_id: HIT_ID, // gotten from template
      assignment_id: ASSIGNMENT_ID, // gotten from template
      worker_id: WORKER_ID, // gotten from template
      conversation_id: null,
      initialization_status: initialization_status,
      agent_state: STATUS_NONE,
      is_cover_page: IS_COVER_PAGE, // gotten from template
      done_text: null,
      chat_state: 'idle', // idle, text_input, inactive, done
      task_done: false,
      messages: [],
      agent_id: 'NewWorker',
      task_data: {},
      volume: 1, // min volume is 0, max is 1, TODO pull from local-storage?
    };
  }

  handleAgentStatusChange(agent_status, conversation_id, done_text, agent_id) {
    // Covers conversation changes and state restores in-conversation
    if (conversation_id != this.state.conversation_id) {
      this.setState({
          agent_status: agent_status,
          conversation_id: conversation_id,
          agent_id: agent_id,
        });
      if (conversation_id == 'waiting') {
        this.setState({ messages: [], chat_state: 'waiting' });
      }
    }

    if (agent_status != this.state.agent_status) {
      // Handle required state changes on a case-by-case basis.
      if ([STATUS_DONE, STATUS_PARTNER_DISCONNECT].includes(agent_status)) {
        this.setState({ task_done: true, chat_state: 'done' });
      } else if ([STATUS_DISCONNECT, STATUS_RETURNED, STATUS_EXPIRED]
                 .includes(agent_status)) {
        this.setState({ chat_state: 'inactive' });
      }
      this.setState({ agent_status: agent_status, done_text: done_text});
    }
  }

  playNotifSound() {
    let audio = new Audio('./notif.mp3');
    audio.volume = this.state.volume;
    audio.play();
  }

  handleIncomingHITData(data) {
    let task_description = data['task_description'];
    if (isMobile() && BLOCK_MOBILE) {
      task_description =
        '<h1>Sorry, this task cannot be completed on mobile devices. ' +
        'Please use a computer.</h1><br>Task Description follows:<br>' +
        data['task_description'];
    }

    this.setState({
      task_description: task_description,
      frame_height: data['frame_height'] || DEFAULT_FRAME_HEIGHT,
      mturk_submit_url: data['mturk_submit_url'],
    });
  }

  componentDidMount() {
    getHitConfig(data => this.handleIncomingHITData(data));
  }

  onMessageSend(text, data, callback, is_system) {
    if (text === '') {
      return;
    }
    this.socket_handler.handleQueueMessage(text, data, callback, is_system);
  }

  render() {
    let socket_handler = null;
    if (!this.state.is_cover_page) {
      socket_handler = (
        <SocketHandler
          onNewMessage={new_message => {
            this.state.messages.push(new_message);
            this.setState({ messages: this.state.messages });
          }}
          onNewTaskData={new_task_data =>
            this.setState({
              task_data: Object.assign(this.state.task_data, new_task_data),
            })
          }
          onRequestMessage={() => this.setState({ chat_state: 'text_input' })}
          onForceDone={allDoneCallback}
          onSuccessfulSend={() =>
            this.setState({
              chat_state: 'waiting',
              messages: this.state.messages,
            })
          }
          onAgentStatusChange={
            (agent_status, conversation_id, done_text, agent_id) =>
              this.handleAgentStatusChange(
                agent_status, conversation_id, done_text, agent_id)
          }
          onConfirmInit={() => this.setState({ initialization_status: 'done' })}
          onFailInit={() => this.setState({ initialization_status: 'failed' })}
          onStatusChange={status => this.setState({ socket_status: status })}
          assignment_id={this.state.assignment_id}
          conversation_id={this.state.conversation_id}
          worker_id={this.state.worker_id}
          agent_id={this.state.agent_id}
          hit_id={this.state.hit_id}
          initialization_status={this.state.initialization_status}
          agent_state={this.state.agent_state}
          messages={this.state.messages}
          task_done={this.state.task_done}
          ref={m => {
            this.socket_handler = m;
          }}
          playNotifSound={() => this.playNotifSound()}
          run_static={false}
        />
      );
    }
    return (
      <div>
        <BaseFrontend
          task_done={this.state.task_done}
          done_text={this.state.done_text}
          chat_state={this.state.chat_state}
          onMessageSend={(m, d, c, s) => this.onMessageSend(m, d, c, s)}
          socket_status={this.state.socket_status}
          messages={this.state.messages}
          agent_id={this.state.agent_id}
          task_description={this.state.task_description}
          initialization_status={this.state.initialization_status}
          is_cover_page={this.state.is_cover_page}
          frame_height={this.state.frame_height}
          task_data={this.state.task_data}
          world_state={this.state.agent_state}
          v_id={this.state.agent_id}
          allDoneCallback={() => allDoneCallback()}
          volume={this.state.volume}
          onVolumeChange={v => this.setState({ volume: v })}
          display_feedback={DISPLAY_FEEDBACK}
        />
        <MTurkSubmitForm
          assignment_id={this.state.assignment_id}
          hit_id={this.state.hit_id}
          worker_id={this.state.worker_id}
          mturk_submit_url={this.state.mturk_submit_url}
        />
        {socket_handler}
      </div>
    );
  }
}


// TODO consolidate shared functionality from SocketManager in a way that
// prevents this class from setting a whole lot of dummy methods
// TODO update static functionality to cover socket changes
class StaticApp extends React.Component {
  constructor(props) {
    super(props);
    let initialization_status = 'initializing';
    if (!doesSupportWebsockets()) {
      initialization_status = 'websockets_failure';
    }

    // TODO move constants to props rather than state
    this.state = {
      task_description: null,
      mturk_submit_url: null,
      frame_height: FRAME_HEIGHT,
      socket_status: null,
      hit_id: HIT_ID, // gotten from template
      assignment_id: ASSIGNMENT_ID, // gotten from template
      worker_id: WORKER_ID, // gotten from template
      conversation_id: null,
      initialization_status: initialization_status,
      world_state: null, // TODO cover onboarding and waiting separately
      is_cover_page: IS_COVER_PAGE, // gotten from template
      done_text: null,
      chat_state: 'idle', // idle, text_input, inactive, done
      task_done: false,
      messages: [],
      agent_id: 'NewWorker',
      task_data: {},
      response_data: {},
      volume: 1, // min volume is 0, max is 1, TODO pull from local-storage?
    };
  }

  handleIncomingHITData(data) {
    let task_description = data['task_description'];
    if (isMobile() && BLOCK_MOBILE) {
      task_description =
        '<h1>Sorry, this task cannot be completed on mobile devices. ' +
        'Please use a computer.</h1><br>Task Description follows:<br>' +
        data['task_description'];
    }

    this.setState({
      task_description: task_description,
      frame_height: data['frame_height'] || DEFAULT_FRAME_HEIGHT,
      mturk_submit_url: data['mturk_submit_url'],
    });
  }

  componentDidMount() {
    getHitConfig(data => this.handleIncomingHITData(data));
  }

  onMessageSend(text, data, callback, is_system) {
    if (text === '') {
      return;
    }
    this.socket_handler.handleQueueMessage(text, data, callback, is_system);
  }

  onValidData(valid, response_data) {
    this.setState({task_done: valid, response_data: response_data});
  }

  render() {
    let socket_handler = null;
    if (!this.state.is_cover_page) {
      socket_handler = (
        <SocketHandler
          onNewMessage={new_message => {
            this.state.messages.push(new_message);
            this.setState({ messages: this.state.messages });
          }}
          onNewTaskData={new_task_data =>
            this.setState({
              task_data: Object.assign(this.state.task_data, new_task_data),
            })
          }
          onRequestMessage={() => {}}
          onTaskDone={() => {}}
          onInactiveDone={inactive_text =>
            this.setState({
              task_done: true,
              chat_state: 'done',
              done_text: inactive_text,
            })
          }
          onForceDone={() => { /* ForceDone never called in static flow */ }}
          onExpire={expire_reason =>
            this.setState({
              chat_state: 'inactive',
              done_text: expire_reason,
            })
          }
          onConversationChange={(world_state, conversation_id, agent_id) => {
            this.setState({
              world_state: world_state,
              conversation_id: conversation_id,
              agent_id: agent_id,
            });
          }}
          onSuccessfulSend={() => {}}
          onConfirmInit={() => this.setState({ initialization_status: 'done' })}
          onFailInit={() => this.setState({ initialization_status: 'failed' })}
          onStatusChange={() => {}}
          assignment_id={this.state.assignment_id}
          conversation_id={this.state.conversation_id}
          worker_id={this.state.worker_id}
          agent_id={this.state.agent_id}
          hit_id={this.state.hit_id}
          initialization_status={this.state.initialization_status}
          messages={this.state.messages}
          task_done={this.state.task_done}
          ref={m => {
            this.socket_handler = m;
          }}
          playNotifSound={() => {}}
          run_static={true}
        />
      );
    }
    return (
      <div>
        <StaticFrontend
          task_done={this.state.task_done}
          done_text={this.state.done_text}
          chat_state={this.state.chat_state}
          onMessageSend={(m, d, c, s) => this.onMessageSend(m, d, c, s)}
          socket_status={this.state.socket_status}
          messages={this.state.messages}
          agent_id={this.state.agent_id}
          task_description={this.state.task_description}
          initialization_status={this.state.initialization_status}
          is_cover_page={this.state.is_cover_page}
          frame_height={this.state.frame_height}
          task_data={this.state.task_data}
          world_state={this.state.world_state}
          v_id={this.state.agent_id}
          allDoneCallback={() => staticAllDoneCallback(
            this.state.agent_id,
            this.state.assignment_id,
            this.state.worker_id,
            this.state.response_data,
          )}
          volume={this.state.volume}
          onVolumeChange={v => this.setState({ volume: v })}
          display_feedback={DISPLAY_FEEDBACK}
          onValidDataChange={(valid, data) => this.onValidData(valid, data)}
        />
        <MTurkSubmitForm
          assignment_id={this.state.assignment_id}
          hit_id={this.state.hit_id}
          worker_id={this.state.worker_id}
          response_data={this.state.response_data}
          mturk_submit_url={this.state.mturk_submit_url}
        />
        {socket_handler}
      </div>
    );
  }
}

var main_app = (TEMPLATE_TYPE == 'static') ? <StaticApp /> : <MainApp />;

ReactDOM.render(main_app, document.getElementById('app'));
