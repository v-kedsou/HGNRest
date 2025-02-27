const mongoose = require('mongoose');
const moment = require('moment-timezone');
const _ = require('lodash');
const userProfile = require('../models/userProfile');
const myteam = require('../helpers/helperModels/myTeam');
const dashboardhelper = require('../helpers/dashboardhelper')();

const emailSender = require('../utilities/emailSender');

const logger = require('../startup/logger');

const userhelper = function () {
  const getTeamMembers = function (user) {
    const userid = mongoose.Types.ObjectId(user._id);
    // var teamid = userdetails.teamId;
    return myteam.findById(userid).select({
      'myteam._id': 1,
      'myteam.role': 1,
      'myteam.fullName': 1,
      _id: 0,
    });
  };

  const getUserName = async function (userId) {
    const userid = mongoose.Types.ObjectId(userId);
    return userProfile.findById(userid, 'firstName lastName');
  };

  const validateprofilepic = function (profilePic) {
    const picParts = profilePic.split('base64');
    let result = true;
    const errors = [];

    if (picParts.length < 2) {
      return {
        result: false,
        errors: 'Invalid image',
      };
    }

    // validate size
    const imagesize = picParts[1].length;
    const sizeInBytes = (4 * Math.ceil(imagesize / 3) * 0.5624896334383812) / 1024;

    if (sizeInBytes > 50) {
      errors.push('Image size should not exceed 50KB');
      result = false;
    }

    const imagetype = picParts[0].split('/')[1];
    if (imagetype !== 'jpeg;' && imagetype !== 'png;') {
      errors.push('Image type shoud be either jpeg or png.');
      result = false;
    }

    return {
      result,
      errors,
    };
  };
  const getInfringmentEmailBody = function (firstName, lastName, infringment) {
    const text = `Dear <b>${firstName} ${lastName}</b>, 
        <p>
        Oops, it looks like something happened and you’ve managed to get a blue square.</p>
        <b>
        <div>Date Assigned: ${infringment.date}</div>
        <div>Description : ${infringment.description}</div>
        </b>
        <p>        
        No worries though, life happens and we understand that. That’s why we allow 5 of them before taking action. This action usually includes removal from our team, so please let your direct supervisor know what happened and do your best to avoid future blue squares if you are getting close to 5 and wish to avoid termination. Each blue square drops off after a year.
        </p>
        <p>Thank you,</p>
        <p><b> One Community </b></p>`;

    return text;
  };

  const assignBlueBadgeforTimeNotMet = function () {
    logger.logInfo(
      `Job for assigning blue badge for commitment not met starting at ${moment()
        .tz('America/Los_Angeles')
        .format()}`,
    );
    const pdtStartOfLastWeek = moment()
      .tz('America/Los_Angeles')
      .startOf('week')
      .subtract(1, 'week');
    const pdtEndOfLastWeek = moment()
      .tz('America/Los_Angeles')
      .endOf('week')
      .subtract(1, 'week');
    userProfile
      .find(
        {
          isActive: true,
        },
        '_id',
      )
      .then((users) => {
        users.forEach((user) => {
          const personId = mongoose.Types.ObjectId(user._id);

          dashboardhelper
            .laborthisweek(personId, pdtStartOfLastWeek, pdtEndOfLastWeek)
            .then((results) => {
              const { weeklyComittedHours } = results[0];
              const timeSpent = results[0].timeSpent_hrs;
              if (timeSpent < weeklyComittedHours) {
                const description = `System auto-assigned infringement for not meeting weekly volunteer time commitment. You logged ${timeSpent} hours against committed effort of ${weeklyComittedHours} hours in the week starting ${pdtStartOfLastWeek.format(
                  'dddd YYYY-MM-DD',
                )} and ending ${pdtEndOfLastWeek.format('dddd YYYY-MM-DD')}`;
                const infringment = {
                  date: moment()
                    .utc()
                    .format('YYYY-MM-DD'),
                  description,
                };
                userProfile
                  .findByIdAndUpdate(personId, {
                    $push: {
                      infringments: infringment,
                    },
                  })
                  .then(status => emailSender(
                    status.email,
                    'New Infringment Assigned',
                    getInfringmentEmailBody(
                      status.firstName,
                      status.lastName,
                      infringment,
                    ),
                    null,
                    'onecommunityglobal@gmail.com',
                  ))
                  .catch(error => logger.logException(error));
              }
            })
            .catch(error => logger.logException(error));
        });
      })
      .catch(error => logger.logException(error));
  };

  const deleteBadgeAfterYear = function () {
    logger.logInfo(
      `Job for deleting badges older than 1 year starting at ${moment()
        .tz('America/Los_Angeles')
        .format()}`,
    );
    const cutOffDate = moment()
      .subtract(1, 'year')
      .format('YYYY-MM-DD');
    userProfile
      .updateMany(
        {},
        {
          $pull: {
            infringments: {
              date: {
                $lte: cutOffDate,
              },
            },
          },
        },
      )
      .then(results => logger.logInfo(results))
      .catch(error => logger.logException(error));
  };

  const notifyInfringments = function (
    original,
    current,
    firstName,
    lastName,
    emailAddress,
  ) {
    if (!current) return;
    const newOriginal = original.toObject();
    const newCurrent = current.toObject();
    let newInfringments = [];
    newInfringments = _.differenceWith(
      newCurrent,
      newOriginal,
      (arrVal, othVal) => arrVal._id.equals(othVal._id),
    );
    newInfringments.forEach((element) => {
      emailSender(
        emailAddress,
        'New Infringment Assigned',
        getInfringmentEmailBody(firstName, lastName, element),
        null,
        'onecommunityglobal@gmail.com',
      );
    });
  };

  return {
    getUserName,
    getTeamMembers,
    validateprofilepic,
    assignBlueBadgeforTimeNotMet,
    deleteBadgeAfterYear,
    notifyInfringments,
    getInfringmentEmailBody,
  };
};

module.exports = userhelper;
