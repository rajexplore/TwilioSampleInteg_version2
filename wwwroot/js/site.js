﻿// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT license.

// Please see documentation at https://docs.microsoft.com/aspnet/core/client-side/bundling-and-minification
// for details on configuring this project to bundle and minify static web assets.

/* For the possible phone states, "renderWidget" is the toast-area div and "renderSidePanel" is
 * the side-bar area div that should be made visible */
var PhoneState = Object.freeze({
    Idle: { renderWidget: ".idlePhone", renderSidePanel: ".idlePhoneSidebar" },
    Ongoing: { renderWidget: ".ongoingCall", renderSidePanel: ".ongoingCallSidebar" },
    Incoming: { renderWidget: ".incomingCall", renderSidePanel: ".ongoingCallSidebar" },
    Dialing: { renderWidget: ".outgoingCall", renderSidePanel: ".ongoingCallSidebar" },
    CallAccepted: { renderWidget: ".incomingCall", renderSidePanel: ".ongoingCallSidebar" },
    CallSummary: { renderWidget: ".callSummary", renderSidePanel: ".idlePhoneSidebar" }
});

var CallDirection = Object.freeze({
    None: 0,
    Incoming: 1,
    Outgoing: 2
});

var DisplayMode = Object.freeze({
    Minimized: 0,   //XrmClientApi.Constants.PanelState.Collapsed
    Docked: 1,       //XrmClientApi.Constants.PanelState.Expanded
    Hidden: 2
});

/* In expanded mode, the toast area will be set to this width.
 * This is set at runtime based on available screen width. See site.css:root */
var expandedWidgetWidth = "271fr";

/* Whether Minimized or Docked Or Hidden */
var _CurrentPanelMode = null;

var _currentCallHoldState = 0; //Call is not on hold

/* A timer for counting the duration of current call in the current state */
class Timer {
    /* timerElemjQuery - Will update the value of all DOM elements returned by this jquery to current timer value
     * startElemJQuery - Will update the value of all DOM elements returned by this jquery to timer start time
     * refreshInterval - the timer periodicity */
    constructor(timerElemJQuery, startElemJQuery, refreshInterval) {
        this._start = null;
        this._timerElemjQuery = timerElemJQuery;
        this.refreshInterval = refreshInterval;
        this._handle = null;
        this._startElemjQuery = startElemJQuery;
        this._duration = 0;
    }
    get refreshInterval() {
        return this._refreshInterval;
    }
    set refreshInterval(value) {
        this._refreshInterval = value;
    }
    /* Stop the timer with value frozen at current instance */
    stop() {
        if (this._handle) {
            window.clearInterval(this._handle);
            this._handle = null;
        }
    }
    /* Stop the timer and reset it to zero */
    reset() {
        this.stop();
        $(this._timerElemjQuery).text("00");
        this._start = null;
        this._duration = 0;
    }
    get startTime() {
        return this._start;
    }
    get duration() {
        return this._duration;
    }
    start() {
        if (this._start) {
            this.stop();
        }
        this._start = new Date();
        $(this._startElemjQuery).text(this._start.toLocaleTimeString());
        this._handle = window.setInterval(function () {
            var now = new Date().getTime();
            var secs = (now - this._start.getTime()) / 1000;
            this._duration = secs;
            var timeStr = Utility.getHHMMSS(secs);

            // update the timer count only if current call session is focussed session as well.
            Microsoft.CIFramework.getFocusedSession().then((sessionId) => {
                if (sessionId == phone.currentCallSessioId) {
                    $(this._timerElemjQuery).text(timeStr);
                }
            });
        }.bind(this), this.refreshInterval);
    }

    // called when we switch session to update DOM with right values of timer
    renderStartAndDuration() {
        $(this._startElemjQuery).text(this._start.toLocaleTimeString());
        $(this._timerElemjQuery).text(Utility.getHHMMSS(this.duration));
    }
};

class Utility {

    static getHHMMSS(secs) {
        var hrs = Math.floor(secs / 3600);
        secs = secs % 3600;
        var mins = Math.floor(secs / 60);
        secs = Math.floor(secs % 60);
        var timeStr = hrs + ":" + mins + ":" + secs;
        return timeStr;
    }

    // Gets the "val" string from "{val}". used when we get response as {entityId} or {userId}
    static stripParens(val) {
        var start = val.indexOf('{') + 1, end = val.lastIndexOf('}');
        end = (end > 0 ? end : val.length);
        return val.substring(start, end);
    }

    /* Search, and optionally open the record using CIF API searchAndOpenRecords()
     * number -  number which we need to search with if recordId is not known
     * searchOnly - when 'true', search but do not open the record, when 'false', also open the record
     * SesionBag - The session obj which we maintain to update the name details.
     * recordid - An optional CRM record Id to open. If not passed a search based on current phone number will be performed */
    static updateCallerDetailsFromCRM(number, searchOnly, sessionBag, recordId, ) {
        return new Promise(function (resolve, reject) {
            if (!number) {
                return reject("number is  empty"); //Not a phone number or another search in progress
            }
            log("Trying to find name of caller " + number + " with searchOnly=" + searchOnly);
            var query = "?$select=contactid,_parentcustomerid_value,fullname,mobilephone,telephone1&$filter=";   //In this sample, we are retrieving the 'fullname' attribute of the record
            if (recordId) { //oData query to retrieve a specific record
                query += "contactid eq " + recordId;
            }
            else {  //oData query to search all records for current phone number
                query += "contains(mobilephone, '" + number.substring(1) + "') or contains(mobilephone, '" + number.substring(2) + "') or contains(mobilephone, '" + number.substring(3) + "')";
                //oData query to search all records for current business phone number - Added by Rajeev Maithani
                query += " or contains(telephone1, '" + number.substring(1) + "') or contains(telephone1, '" + number.substring(2) + "') or contains(telephone1, '" + number.substring(3) + "')";
                //query += " or contains(address1_telephone1, '" + number.substring(1) + "') or contains(address1_telephone1, '" + number.substring(2) + "') or contains(mobilephone, '" + number.substring(3) + "')";
            } 

            //In this sample, we search all 'contact' records
            Microsoft.CIFramework.searchAndOpenRecords("contact", query, searchOnly).then(
                function (valStr) {    //We got the CRM contact record for our search query
                    try {
                        let val = JSON.parse(valStr);
                        if (sessionBag) {
                            //Record the fullname and CRM record id
                            sessionBag._name = val[0].fullname;
                            sessionBag._contactid = val[0].contactid;
                            callerId = val[0].contactid;
                            callercontactname = val[0].fullname;
                            calleraccountId = val[0]._parentcustomerid_value;
                            log("The caller name is " + val[0].fullname);
                            sessionBag.renderCallerName();

                        }
                        else {
                            $("#callerids").text(val[0].fullname);
                            callerId = val[0].contactid;
                            callercontactname = val[0].fullname;
                            calleraccountId = val[0]._parentcustomerid_value;
                            //callercontactname = val[0].fullname;
                            //jQuery("label[class='callername']").text(val[0].fullname);
                        }
                        resolve({ value: val[0].fullname, isNameFound: true });
                    }
                    catch (e) {
                        log("Unable to find caller name- Exception: " + e);
                        resolve({ value: number, isNameFound: false });
                    }
                }
            ).catch(function (reason) {
                if (!reason) {
                    reason = "Unknown Reason";
                }
                log("Couldn't retrieve caller name because " + reason.toString());
                resolve({ value: number, isNameFound: false });
            });
        });
    }
};

/* Manages a single phone call session */
class Phone {
    /* initialMode - whether to start in Docked or Minimized or Hidden mode */
    constructor(phoneState, sessionid, initialMode) {
        //Added by Rajeev
        this._name = null;          //Current caller name by searching all contact records based on phone number
        this._contactid = null;     //CRM record ID of contact record for current phone number
        this._number = null;        //Current phone number
        this._timer = new Timer(".timer", ".timeStart", 1000);
        this.state = phoneState.Idle;
        //End of addition by Rajeev
        this.conn = null;           //Current Twilio connection
        this.mode = initialMode;
        this._activityId = null;    //Activity record created for current phone session
        this._direction = CallDirection.None;   //Incoming or Outgoing
        this.listOfSessions = new Map(); // List of session Objects which contains the context of each session.
        this.currentCallSessioId = null; // Session Id of the session where call is going on.
        this._environ = null;
        this._caseId = null;        //Any Case/Incident record created for current phone session
        this.sessionId = sessionid;
        this.currentCase = null;
        /* Invoke the CIF API to get current username, appid, language code etc */
        Microsoft.CIFramework.getEnvironment().then(function (res) {
            this._environ = JSON.parse(res);
        }.bind(this));
    }

    /* Our handler CIF whenever any navigation happens on main UCI page.
 * In this sample, we simply record the contact or case record Id to be used for our case or activity record creation */
    pageNavigateHandlerSess(paramStr) {
        return new Promise(function (resolve, reject) {
            try {
                let params = JSON.parse(paramStr);
                if (phone && !this.isNameValid && this.state != PhoneState.Idle && this.state != PhoneState.CallSummary) {
                    var page = params["value"];

                    var queryParams = new URL(page).searchParams;
                    log("Page navigated to " + queryParams.get("etn") + " pagetype " + queryParams.get("pagetype") + " id = " + queryParams.get("id") + " with ph = " + this.name);
                    if (queryParams.get("etn") == "contact" && queryParams.get("pagetype") == "entityrecord") {
                        console.log("Trying to fetch record details based on record id");
                        Utility.updateCallerDetailsFromCRM(this._number, true, this, queryParams.get("id"));
                    }
                    if (queryParams.get("etn") == "incident" && queryParams.get("pagetype") == "entityrecord") {
                        this.currentCase = queryParams.get("id");
                    }
                }
                resolve(true);
            }
            catch (error) {
                reject(error);
            }
        }.bind(this));
    }

    /* Create a new activity record for this phone call using appropriate CIF APIs. */
    createCallActivity() {
        var phActivity = {};
        //Setup basic details of the activity - subject, direction, duration
        phActivity["phonenumber"] = this._number;
        phActivity["subject"] = "Call with " + this.name;
        phActivity["directioncode"] = phone.direction == CallDirection.Incoming ? false : true;
        phActivity["actualdurationminutes"] = Math.trunc(this._timer.duration / 60);
        //Capture any call notes as 'description' attribute of the activity
        phActivity["description"] = $('#callNotesField').text();

        var sysuser = null;
        if (this.currentEnvironment) {
            sysuser = Utility.stripParens(this.currentEnvironment.userId);
        }

        var us = {};

        //If we have the CRM contact record, use it to setup the calling parties for this activity
        if (sysuser && this.contactId) {
            us["partyid_systemuser@odata.bind"] = "/systemusers(" + sysuser + ")";
            us["participationtypemask"] = (this.direction == CallDirection.Incoming ? 2 : 1);

            var them = {};
            them["partyid_contact@odata.bind"] = "/contacts(" + this.contactId + ")";
            them["participationtypemask"] = (this.direction == CallDirection.Incoming ? 1 : 2);

            var parties = [];
            parties[0] = us; parties[1] = them;
            phActivity.phonecall_activity_parties = parties;
        }

        //If any case/incident was created, set it as the 'regarding' object; else just set the contact
        if (this.currentCase) {
            phActivity["regardingobjectid_incident@odata.bind"] = "/incidents(" + Utility.stripParens(this.currentCase) + ")";
        } else if (this.contactId) {
            phActivity["regardingobjectid_contact@odata.bind"] = "/contacts(" + this.contactId + ")";
        }

        //Now invoke CIF to create the phonecall activcity
        Microsoft.CIFramework.createRecord("phonecall", JSON.stringify(phActivity)).then(function (newActivityStr) {
            let newActivity = JSON.parse(newActivityStr);
            this._activityId = newActivity.id;
            $("#activityLink").show();
        }.bind(this));
    }

    /* Display the current caller's name and initials. if the name is not available, display the phone number */
    renderCallerName() {
        var fn = this.name;
        if (!this.name) {
            fn = "Unknown(" + this._number + ")";
        }
        $(".callerName").text(fn);
        var input = {
            "sessionId": this.sessionId,
            "customer": fn
        };
        //alert("Sesion Title" & input & callercontactname & this.name);
        // setSessionTitle needs two params in input bag. 
        // 1. sessionId 
        // 2. slug name which we use in title field of session template record.. In sample, we have given value as "Call from {customer}"
        //    hence we pass "customer" in the input bag parameter.
        Microsoft.CIFramework.setSessionTitle(input);
        var sp = fn.split(" ");
        $(".callerInit").text(sp[0][0] + (sp[1] ? sp[1][0] : sp[0][1]));
    }

    /* For an ongoing call, search and open contact record for the calling phone number */
    updateCRMPage() {
        if (this.state != PhoneState.Ongoing) {
            return;
        }
        Utility.updateCallerDetailsFromCRM(this._number, false, this);
        log("Initiated CRM page update");
    }

    /**
  * Handler when the user selects the Send button in the Knowledge Base control
  * @param {any} paramStr Parameters
  */
    sendKBArticleHandlerSess(paramStr) {
        return new Promise(function (resolve, reject) {
            try {
                let params = JSON.parse(paramStr);
                var kbMsg = "KB Title: " + params["title"] + " KB link: " + params["link"];
                log("Send KB article invoked " + kbMsg);
                //$(".callNotesField").empty();
                $(".callNotesField").append(kbMsg);
                $(".callNotes").show(); //DEBUGGING ONLY
            }
            catch (error) {
            }
        });
    }

    /* Current contact name, if available */
    get name() {
        if (this._name) {
            return this._name;
        }
        else {
            return this._number;
        }
    }

    /* Any Case, if created */
    get currentCase() {
        return this._caseId;
    }
    set currentCase(value) {
        this._caseId = value;
    }
    get isNameValid() {
        return (this._name ? true : false);
    }

    /* Update the current name. If we only have a phone number, initiate a lookup into CRM */
    set name(value) {
        if (!value) {
            this._name = this._number = null;
            return;
        }
        if (value.startsWith("+")) {    //We have a phone number but no name
            this._number = value;
            //this.updateCallerDetailsFromCRM(true);
            Utility.updateCallerDetailsFromCRM(this._number, true, this);
            log("Initiated number lookup");
        }
        else {
            this._name = value;
        }
    }

    get contactId() {
        return this._contactid;
    }

    get direction() {
        return this._direction;
    }

    get state() {
        if (!this._state) {
            return PhoneState.Idle;
        }
        return this._state;
    }

    get activityId() {
        return this._activityId;
    }

    get currentEnvironment() {
        return this._environ;
    }

    /* End the current phone call, disconnecting Twilio as well */
    endCall(oldState) {
        if (this._conn) {
        if (oldState == PhoneState.Incoming) {
                phone.conn.reject();
            }
            log("Phone state changed to idle. Disconnecting all calls");
            Twilio.Device.disconnectAll();
            phone.conn = null;
        }
    }

    /* Manages state transition of the phone call
     *  - update the UI
     *  - Update internal state and execute required CRM states (creating a case, activity, searching records etc)
     *  - manage Twilio connection state */
    set state(value) {
        if (this._state == value) {
            return;
        }

        let oldState = this._state;
        this._state = value;
        this.updateCRMPage();

        if (this._state != PhoneState.CallSummary) {
            $(".activityLink").hide();
        }
        switch (this._state) {
            case PhoneState.Idle:
                this._timer.reset();
                this.name = null;
                this._number = null;
                this._contactid = null;
                this._activityId = null;
                $(".callerName").empty();
                $(".callerInit").empty();
                $('#dialerPhoneNumber').empty();
                this.endCall(oldState);
                this._direction = CallDirection.None;
                this.currentCase = null;
                //if(oldState)                                            //DEBUG ONLY
                //    document.location.href = document.location.href;    //DEBUG ONLY 
                break;
            case PhoneState.CallSummary:
                this._timer.stop();
                this.endCall(oldState);
                this.createCallActivity();
                //if (this.currentCase)
                    $("#caseLink").text("Case Details");
                //else 
                //    $("#caseLink").text("---Not avaiable");
                $("#caseLink").show();
                $("#totaltime").hide();
                $("#totaltimeLabel").hide();
                $("#startTime").hide();
                $("#startTimeLabel").hide();
                break;
            case PhoneState.Incoming:
                this._direction = CallDirection.Incoming;
                this._timer.start();
                break;
            case PhoneState.Outgoing:
                this._direction = CallDirection.Outgoing;
                this._timer.start();
                break;
            default:
                //this._timer.start();
        }
        this.render();
    }

    get conn() {
        return this._conn;
    }
    set conn(value) {
        this._conn = value;
        if (this._conn == null) {
            this.currentCallSessioId = null;
        }
    }
    get mode() {
        return this._mode;
    }
    set mode(value) {
        if (this._mode == value) {
            return;
        }
        this._mode = value;
        log("Invoking setPanelMode");
        setPanelMode(this._mode);
        log("Done setPanelmode");
        this.render();
    }

    render() {
        if (this.state == PhoneState.Ongoing || this.state == PhoneState.CallSummary) {
            $(".callNotes").show();
        }
        else {
            $(".callNotes").hide();
        }

        if (this.state == PhoneState.Idle) {
            $(".callNotesField").empty();
        }

        if (this.state == PhoneState.CallSummary) {
            $(".notesMenuItem").show();
        }
        else {
            $(".notesMenuItem").hide();
        }

        //this.renderCallerName();
        let widgetToRender = (this.mode == DisplayMode.Minimized ? null : this.state.renderWidget);
        let sidePanelToRender = this.state.renderSidePanel;
        Object.values(PhoneState).forEach((state) => {
            if (state.renderWidget != widgetToRender) {
                $(state.renderWidget).hide();
            }
            if (state.renderSidePanel != sidePanelToRender) {
                $(state.renderSidePanel).hide();
            }
        });
        $(widgetToRender).show();
        $(sidePanelToRender).show();
    }
}
/* Programatically set the panel mode using CIF */
function setPanelMode(mode) {
    if (_CurrentPanelMode == mode) {
        return;
    }
        Microsoft.CIFramework.setMode(mode).then(function (val) {
            log("Successfully set the panel mode " + val);
            _CurrentPanelMode = mode;
        }).catch(function (reason) {
            log("Failed to set mode due to: " + reason);
        });
}

/* Our clickToAct handler. This will place a phone call and change the phone state accordingly */
function clickToActHandler(paramStr) {
    return new Promise(function (resolve, reject) {
        try {
            let params = JSON.parse(paramStr);
            var phNo = params.value;   //Retrieve the phone number to dial from parameters passed by CIF
            log("Click To Act placing a phone call to " + phNo);
            $("#dialerPhoneNumber").val(phNo);
            expandPanel();  //Programatically expand the panel if required
            placeCall();    //Make the call
            resolve(true);
        }
        catch (error) {
            reject(error);
        }
    });

}

//called whenever sessions of given provider are switched. 
// if i switch from session1 to session2, i get two events.
// one with input as {sessionId: session-id-1, focused:false}
// Other with input as {sessionId: session-id-2, focused:true}
// One for focused out session and other for focused in session.
function onSessionSwitchHandler(paramStr) {
    console.log(paramStr);
    if (paramStr == null || paramStr == undefined) {
        return;
    }
    var params = JSON.parse(paramStr);
    var sess = phone.listOfSessions.get(params.sessionId);
    if (params.focused) {
        if (sess != null) {
            sess.render(); // render the current session widget
            sess._timer.renderStartAndDuration(); // render the timer with the current session values
            reStoreSessionInfoToWidget(params.sessionId); // re store session data to widget dom
        }
    }
    else {
        storeWidgetDataToSessionInfo(params.sessionId);// store widget DOM inputs  to session object
    }
   // refreshWidget(sess); // refreshes the widget 
}

/* Our handler invoked by CIF whenever any navigation happens on main UCI page.
* In this sample, we simply record the contact or case record Id to be used for our case or activity record creation */
function pageNavigateHandler(paramStr) {
    Microsoft.CIFramework.getFocusedSession().then((sessionid) => {
        var sess = phone.listOfSessions.get(sessionid);
        sess.pageNavigateHandlerSess(paramStr);
    });
}

/**
 * Handler invoked by CIF when user selects the send button in the Knowledge Base control
 * @param {any} paramStr The parameter bag
 */
function sendKBArticleHandler(paramStr) {
    Microsoft.CIFramework.getFocusedSession().then((sessionid) => {
        var sess = phone.listOfSessions.get(sessionid);
        sess.sendKBArticleHandlerSess(paramStr);
    });
}

/* Our handler invoked by CIF when the user changes panel mode */
function modeChangedHandler(paramStr) {
    return new Promise(function (resolve, reject) {
        try {
            let params = JSON.parse(paramStr);
            var mode = params["value"];
            log("Mode changed to " + mode);
            //Get the new mode from the parameters passed by CIF and update our state accordingly
            if (mode == DisplayMode.Docked) {
                expandPanel();
            }
            else if (mode == DisplayMode.Hidden) {
                HidePanel();
            }
            else {
                collapsePanel();
            }
            resolve(true);
        }
        catch (error) {
            reject(error);
        }
    });

}

var phone = null;   //The global phone object in this sample
var callercontactname = null;//The global variable to hold the contact fullname
var calleraccountId = null;//The global variable to hold the account 
var callerId = null; //The global variable to hold the contact ID

/**
 * Notifies about the incoming call using CIF API
 * @param {any} number The phone number
 */
function notificationCIF(number) {
    Utility.updateCallerDetailsFromCRM(number, true, this.sessionid).then((result) => {
        console.log(result);
        var input = {
            templateName: "msdyn_IncomingCallNotification",
            templateParameters: {
                number: result.value
            }
        }
        var promise = Microsoft.CIFramework.notifyEvent(input);
        promise.then(function (result) {
            console.log(result);
            let resp = JSON.parse(result);
            if (resp["actionName"] == "Accept") {
                this.answerCall();
            }
            if (resp["actionName"] == "Reject") {
                this.declineCall();
            }
        }.bind(this),
            function (error) {
                console.log(error);
                this.declineCall();
            }.bind(this));
    }.bind(this));

}

/* Our handler to be invoked by Twilio for an incoming call.
 * If the call is acceptable, set the phone state appropriately to trigger our sample work-flow */
function incomingCall(conn) {
    if (phone.conn != null) {
        log("Can't accept another call when one is in progress");
        conn.reject();  //not supporting multiple calls right now
        return;
    }
    //var sess = phone.listOfSessions.get(phone.currentCallSessioId);
    //phone.state = PhoneState.Idle;  //Ensure we start with a clean slate
    //sess.state = PhoneState.Idle;
    phone.conn = conn;
    expandPanel();                  //Programatically expand the panel using CIF
    //sess.state = PhoneState.Incoming;
    phone.state = PhoneState.Incoming;
    //sess.name = conn.parameters.From;
    //phone.name = conn.parameters.From;
    notificationCIF(conn.parameters.From);
    log("Received incoming call from " + conn.parameters.From);
}

/* Display the toast area along with the sidebar area */
function expandPanel() {
    phone.mode = DisplayMode.Docked;
    $(".expanded").show();
}

/* Hide the toast area; only display sidebar area */
function collapsePanel() {
    phone.mode = DisplayMode.Minimized;
    $(".expanded").hide();
}

function HidePanel() {
    phone.mode = DisplayMode.Hidden;
}

/* Event handler for when user clicks on "accept call" button.
 * Update our state to Accepted */
function answerCall() {
    
    var num = phone.conn.parameters.From;
    if (num.indexOf("+") == 0) {
        num = num.substring(1);
    }
    var inputBag = {
        "templateName": "msdyn_TwilioCallSessionTemplate", "templateParameters": { "fullname": callercontactname, "accountID": calleraccountId, "contactID": callerId}
    };
    Microsoft.CIFramework.createSession(inputBag).then(
        function success(sessionId) {
            //var sessionPh = new SessionInfo(PhoneState.CallAccepted, sessionId);
            var sessionPh = new Phone(PhoneState.CallAccepted, sessionId);
            sessionPh.name = phone.conn.parameters.From;
            log("Accepting incoming call from " + sessionPh.name);
            if (phone.conn) {
                phone.conn.accept();
            }
            $('#callNotesField').text("");
            phone.listOfSessions.set(sessionId, sessionPh);
            phone.currentCallSessioId = sessionId;

            Utility.updateCallerDetailsFromCRM(phone.conn.parameters.From, !0, sessionPh).then(() => {
                if (sessionPh.contactId != null && sessionPh.contactId != '') {
                    let inputMap = new Map().set("sessionId", sessionId).set("targetRecordType", "contact").set("targetRecordId", sessionPh.contactId);
                    updateConversation(inputMap).then((result) => {
                        console.log("successfully updated conversation: " + result.value + ", with contact Id: " + sessionPh.contactId);
                    },
                        (error) => {
                            console.log(error);
                    });
                } else {
                    console.log('Caller details could not be fetched from CRM, skipping updateConversation api calls.');
                }
            });
        },
        (error) => {
            declineCall();
        });
}

/* Event handler for when the user clicks on "Decline call" button */
function declineCall() {
    if (phone.conn) {
        phone.conn.reject();
        phone.conn = null;
        phone.currentCallSessioId = null;
    }
    collapsePanel();
    log("Declining incoming call from ");
}

/* Our callback to be invoked by Twilio when a call is successfully connected */
function ongoingCall() {
    //var sess = phone.listOfSessions.get(phone.currentCallSessioId);
    //sess.state = PhoneState.Ongoing;
    phone.state = PhoneState.Ongoing;
    //phone.state = PhoneState.Dialing;
    log("Ongoing call with " + phone.name);
}

/* Event handler for when the user clicks on the "hang up" button */
function hangupCall() {
    //var sess = phone.listOfSessions.get(phone.currentCallSessioId);
    phone.state = PhoneState.CallSummary;
    //sess.state = PhoneState.CallSummary;
    log("Hanging up call with " + phone.name);
}

/* Event handler to be invoked when the user wishes to place a call via either "clickToAct" or using our rudimentary dialer */
function placeCall() {
    if (phone.busy) {
        throw new Error("Cannot place call. Phone busy");
    }
    var params = {
        To: "+" + document.getElementById('dialerPhoneNumber').value
    };
    phone.state = PhoneState.Idle;
    log('Placing a call to ' + params.To + '...');
    phone.name = params.To;

    Twilio.Device.connect(params);
    phone.state = PhoneState.Dialing;
}

/** Event handler when the user clicks on bing button.*/
function searchBing() {
    Microsoft.CIFramework.getFocusedSession().then((sessionId) => {
        var sessionI = phone.listOfSessions.get(sessionId);
        var id = "00000000-0000-0000-0000-000000000000";
        if (sessionI.currentCase) {
            id = sessionI.currentCase;
        }
        Microsoft.CIFramework.retrieveRecord("incident", id, "?$select=title").then((result) => {
            var res = JSON.parse(result);
            var input = {
                templateName: "Bing",
                templateParameters: {
                    searchQ: res.title
                },
                isFocused: true
            }
            Microsoft.CIFramework.createTab(input)
        },
            (error) => {
                var input = {
                    templateName: "Bing",
                    templateParameters: {
                        searchQ: ""
                    },
                    isFocused: true

                }
                Microsoft.CIFramework.createTab(input)
            });
    });
}

/* Event handler for the dialpad button on the sidebar */
function resetPhone() {
    if (phone && !phone.busy) {
        phone.state = PhoneState.Idle;
    }
}

/* Invoke CIF APIs to create a new case record.
 * This will open the case create form with certain fields like contactId and description pre-populated */
function createCase() {

    Microsoft.CIFramework.getFocusedSession().then((sessionId) => {
        var sessionI = phone.listOfSessions.get(sessionId);
        var templatedata = {};
        templatedata["title"] = "Case for " + callercontactname;//"case for " + callercontactname;
        templatedata["description"] = $('#callNotesField').text();
        //condition added to check if the Account is going into the Customer field, then the Contact field should be filled in.
        //else if the Contact is going into the Customer field, then the Contact field should be blank.
        if (calleraccountId != null) {
            templatedata["customerid_account@odata.bind"] = "/accounts(" + calleraccountId + ")";
            templatedata["primarycontactid@odata.bind"] = "/contacts(" + sessionI.contactId + ")";
        }
        else {
            templatedata["customerid_contact@odata.bind"] = "/contacts(" + sessionI.contactId + ")";
        }
        templatedata["caseorigincode"] = 1;

        if (sessionI.contactId != null && sessionI.contactId != '') {
            Microsoft.CIFramework.createRecord("incident", JSON.stringify(templatedata)).then((result) => {
                var res = JSON.parse(result);
                sessionI.currentCase = res.id
                var input = {
                    templateName: "entityrecord",
                    templateParameters: {
                        entityName: "incident",
                        entityId: res.id,
                    },
                    isFocused: true
                }

                Microsoft.CIFramework.createTab(input).then((result) => {
                    $("#caseLink").text("Case Details");
                    console.log("created tab with id " + result);
                },
                    (error) => {
                        console.log(error);
                    }
                );

                let inputMap = new Map().set("sessionId", sessionI.sessionId).set("targetRecordType", "incident").set("targetRecordId", res.id);
                updateConversation(inputMap).then((result) => {
                    console.log("successfully updated conversation: " + result.value + ", with incident id:" + res.id);
                },
                    (error) => {
                        console.log(error);
                    }
                );
            });
        } else {
            console.log("Caller details could not be fetched from CRM, skipping case creation.");
        }
    });
}

/* Event handler. When clicked, opens the activity record created for this phone call */
function openActivity() {
    var ef = {};
    Microsoft.CIFramework.getFocusedSession().then((sessionId) => {

        var sessionI = phone.listOfSessions.get(sessionId);

        ef["entityName"] = "phonecall";
        if (sessionI.activityId) {
            ef["entityId"] = sessionI.activityId;
        }
        var input = {
            templateName: "entityrecord",
            templateParameters: {
                entityName: "phonecall",
                entityId: ef["entityId"]
            },
            isFocused: true
        }
        Microsoft.CIFramework.createTab(input);
    });
}

/* Event handler. When clicked, opens the case record created for this phone call */
function openCase() {
    var ef = {};
    ef["entityName"] = "incident";
    Microsoft.CIFramework.getFocusedSession().then((sessionId) => {

        var sessionI = phone.listOfSessions.get(sessionId);

        if (sessionI.currentCase) {
            ef["entityId"] = sessionI.currentCase;
        }
        else {
            alert("There is no associated case!");
            return;
        }
        if (ef["entityId"] != null || ef["entityId"] != "") {
            var input = {
                templateName: "entityrecord",
                templateParameters: {
                    entityName: "incident",
                    entityId: ef["entityId"]
                },
                isFocused: true
            }
            Microsoft.CIFramework.createTab(input);
        }
    });
}

/**
 * Called when session is getting focussed out
 * @param {any} sessionId The sessionId of session which is getting focussed out.
 */
function storeWidgetDataToSessionInfo(sessionId) {
    if (sessionId != null) {
        var sessionI = phone.listOfSessions.get(sessionId);
        if (sessionI != null) {
            sessionI.notes = $('#callNotesField').text();
            phone.listOfSessions.get(sessionId, sessionI);
        }
    }
}

/**
 * Refreshes the Widget with the given session info
 * @param {any} currentSession The session info object
 */
function refreshWidget(currentSession) {
    alert(currentSession._state + " -- " + PhoneState.CallSummary);
    if (currentSession._state == PhoneState.CallSummary) {
        $("#activityLink").show();
        if (currentSession.currentCase) {
            $("#caseLink").text("Case details");
        }
        else {
            $("#caseLink").text("Not available-----");
        };
        $("#caseLink").show();
    }
    else {
        $("#activityLink").hide();
        $("#caseLink").hide();
    }
}

/**
 * Called when session is getting focussed in
 * @param {any} sessionId The sessionId of session which is getting focussed in.
 */
function reStoreSessionInfoToWidget(sessionId) {
    if (sessionId != null) {
        var sessionI = phone.listOfSessions.get(sessionId);
        if (sessionI != null) {
            $('#callNotesField').text(sessionI.notes);
        }
    }
}

/* Update the activity record with additional details. In this sample, we update the 'description' field with the notes taken during the call */
function updateActivity() {
    Microsoft.CIFramework.getFocusedSession().then((sessionId) => {
        var sessionI = phone.listOfSessions.get(sessionId);

        if (!sessionI || sessionI.state != PhoneState.CallSummary) {
            return;
        }
        if (!sessionI.activityId) {
            sessionI.createCallActivity();
            return;
        }
        var data = {};
        data["description"] = $('#callNotesField').text();
        sessionI.notes = data["description"];
        Microsoft.CIFramework.updateRecord("phonecall", sessionI.activityId, JSON.stringify(data)).then(function (ret) {
            openActivity();
        });
    });
}

/* Initialization function for this application.
 * Registers handlers for various CIF events */
function initCTI() {
    Microsoft.CIFramework.setClickToAct(true);
    Microsoft.CIFramework.addHandler("onclicktoact", clickToActHandler);
    Microsoft.CIFramework.addHandler("onmodechanged", modeChangedHandler);
    Microsoft.CIFramework.addHandler("onpagenavigate", pageNavigateHandler);
    Microsoft.CIFramework.addHandler("onsendkbarticle", sendKBArticleHandler);
    Microsoft.CIFramework.addHandler("onSessionSwitched", onSessionSwitchHandler);
   // Microsoft.CIFramework.addHandler("onSessionClosed", onSessionClosedHandler);
    //var input = {
    //    templateName: "TwilioCallSessionTemplate",
    //    templateParameters: { customer: "Contoso",}
    //};
    //phone = new Phone(0);
    phone = new Phone(PhoneState.Idle, this.sessionid, DisplayMode.Minimized);
    log("Added handlers for the panel");
}

/* Global initialization function. Set up the event handlers, initialize CIF and Twilio */
function initAll() {
    $("img#expand").click(function () {
        expandPanel();
    });
    $("img#collapse").click(function () {
        collapsePanel();
    });
    $("#answerCall").click(function () {
        answerCall();
    });
    $("#declineCall").click(function () {
        declineCall();
    });
    $("#placeCall").click(function () {
        placeCall();
    });
    $(".hangupCall").click(function () {
        Twilio.Device.disconnectAll();
    });
    $("#dialpad").click(function () {
        resetPhone();
    });
    $(".createCase").click(function () {
        createCase();
    });
    $(".searchBing").click(function () {
        searchBing();
    });
    $("#activityLink").click(function () {
        openActivity();
    });
    $("#caseLink").click(function () {
        openCase();
    });
    $("#addNotes").click(function () {
        updateActivity();
    });
    $(".holdCall").click(function () {
        holdUnholdCall();
    });
    log('Requesting Capability Token...');

    $.getJSON(twilioAppURL)
        .done(function (data) {
            log('Got a token.');
            console.log('Token: ' + data.token);

            // Setup Twilio.Device
            Twilio.Device.setup(data.token, { debug: true });

            Twilio.Device.ready(function (device) {
                log('Twilio.Device Ready!');
                initCTI();
            });

            Twilio.Device.error(function (error) {
                log('Twilio.Device Error: ' + error.message);
            });

            Twilio.Device.connect(function (conn) {
                log('Successfully established call!');
                ongoingCall();
            });

            Twilio.Device.disconnect(function (conn) {
                log('Call ended.');
                hangupCall();
            });

            Twilio.Device.incoming(function (conn) {
                incomingCall(conn);
            });
        })
        .fail(function () {
            log('Could not get a token from server!');
        });
}
// Activity log
function log(message) {
    message = new Date().toString() + " " + message;
    console.log(message);
}

// Initializes the twilio and CIF handlers and Objects necessary for the widget
function tryInitAll() {
    let htmlStyles = window.getComputedStyle(document.querySelector("html"));
    expandedWidgetWidth = htmlStyles.getPropertyValue("--expandedWidgetWidth");
    if (twilioLoaded && ciLoaded) {
        initAll();
    }
    else {
        if (!twilioLoaded) {
            console.log("Waiting for twilio libraries to load");
        }
        if (!ciLoaded) {
            console.log("Waiting for CIF libraries to load");
        }
        window.setTimeout(tryInitAll, 100);
    }
}

function holdUnholdCall() {
    let data;
    let eventNameStr;
    if (_currentCallHoldState === 0) {
        eventNameStr = "CallHold";
        _currentCallHoldState = 1;

        data = {
            "events": [
                {
                    "kpiEventName": "CallHold",
                    "kpiEventReason": "CallHold",
                }
            ]
        }
    } else {
        eventNameStr = "CallUnhold";
        _currentCallHoldState = 0;

        data = {
            "events": [
                {
                    "kpiEventName": "CallUnhold",
                    "kpiEventReason": "CallUnhold",
                }
            ]
        }
    }


    Microsoft.CIFramework.logAnalyticsEvent(data, eventNameStr).then((results) => {
        console.log(eventNameStr + " event logged successfully.");
    }, (error) => {
        console.log(error);
    });
}

$(function () {
    tryInitAll();
});

function updateConversation(inputMap) {
    return new Promise(function (resolve, reject) {
        if (inputMap === undefined || inputMap === null) {
            return reject("updateConversation input map is empty, nothing to update");
        }

        Microsoft.CIFramework.getSession(inputMap.get("sessionId")).then((Phone) => {
            let conversationId = Phone.get("conversationId");
            if (conversationId != null && conversationId != '') {
                console.log('Fetched current session details via the getSession api for conversation id: ' + conversationId);
                let data = preparePayloadByUpdateType(inputMap);
                Microsoft.CIFramework.updateConversation(Phone.get('conversationId'), data).then((conversationInfo) => {
                    resolve({ value: JSON.parse(conversationInfo).id });
                },
                    (error) => {
                        console.log(error);
                        reject(error);
                    });
            } else {
                console.log("A live workitem is not available for this session, skipping updateConversation api calls.");
            }  
        },
            (error) => {
                console.log(error);
                reject(error);
            }
        );
    });
}

//called whenever sessions of given provider is closed. 
// if i switch from session1 to session2, i get two events.
// one with input as {sessionId: session-id-1, focused:false}
// Other with input as {sessionId: session-id-2, focused:true}
// One for focused out session and other for focused in session.
function onSessionClosedHandler(paramStr) {
    //console.log(paramStr);
    //alert("Session Closed function triggered");
    //if (paramStr == null || paramStr == undefined) {
    //    return;
    //}
    //var params = JSON.parse(paramStr);
    //var sess = phone.listOfSessions.get(params.sessionId);
    ////if (params.focused) {
    //if (sess != null) {
    //        alert("IF Session Closed" + "------" );
    //    //phone = new Phone(DisplayMode.Minimized);
    //    let widgetToRender = (this.mode == DisplayMode.Minimized ? null : this.state.renderWidget);
    //    let sidePanelToRender = this.state.renderSidePanel;
    //    Object.values(PhoneState).forEach((state) => {
    //        if (state.renderWidget != widgetToRender) {
    //            $(state.renderWidget).hide();
    //        }
    //        if (state.renderSidePanel != sidePanelToRender) {
    //            $(state.renderSidePanel).hide();
    //        }
    //    });
    //    $(widgetToRender).show();
    //    $(sidePanelToRender).show();
    //        sess.render(); // render the current session widget
    //        //sess._timer.renderStartAndDuration(); // render the timer with the current session values
    //        //reStoreSessionInfoToWidget(params.sessionId); // re store session data to widget dom
    //    }
    //    else
    //    {
    //        alert("ELSE Session Closed");
    //        //tryInitAll();
    //    }
    ////}
    ////else {
    ////    //storeWidgetDataToSessionInfo(params.sessionId);// store widget DOM inputs  to session object
    ////}
}

function preparePayloadByUpdateType(inputMap) {
    /**
     * 1. Case: Case details will be updated in the "regardingobjectid" column of the "msdyn_ocliveworkitem" entity, once linked, this will be reflected in the "_regardingobjectid_value" field of the odata results.
     * 2. Contact/Account: Contact/Account details will be updated in the "msdyn_customer" column of the "msdyn_ocliveworkitem" entity, once linked, this will be reflected in the "_msdyn_customer_value" field of the odata results.
     * */
    let data;
    if (inputMap.get("targetRecordType") !== undefined && inputMap.get("targetRecordType") !== null) {
        if (inputMap.get("targetRecordType") === "incident") {//for case
            data = JSON.stringify({ "regardingobjectid_incident@odata.bind": "/incidents(" + inputMap.get("targetRecordId") + ")" });
        } else if (inputMap.get("targetRecordType") === "contact") {//for contact
            data = JSON.stringify({ "msdyn_customer_msdyn_ocliveworkitem_contact@odata.bind": "/contacts(" + inputMap.get("targetRecordId") + ")" });
        } else if (inputMap.get("targetRecordType") === "account") {//for account
            data = JSON.stringify({ "msdyn_customer_msdyn_ocliveworkitem_account@odata.bind": "/accounts(" + inputMap.get("targetRecordId") + ")" });
        } else {
            return reject("Unsupported entity type.");
        }
    } else {
        data = JSON.stringify(inputMap.payload);
    }
    return data;
}