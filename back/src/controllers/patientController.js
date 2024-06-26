const Patient = require("../models/patient/patient");
const User = require("../models/user/user");
const createUserSchema = require("../models/user/createUserSchema");
const updateUserSchema = require("../models/user/updateUserSchema");
const createPatientSchema = require("../models/patient/createPatientSchema");
const updatePatientSchema = require("../models/patient/updatePatientSchema");
const { createUser } = require("./userController");
const { getDayRange } = require("../utils/date");
const loggerService = require("../services/loggerService");
const handleError = require("../utils/errorHandler");

// Get total number of patients
const getTotalPatients = async (request, response) => {
	try {
		const totalPatients = await Patient.countDocuments();
		response.json({ totalPatients });
	} catch (error) {
		handleError(response, error);
	}
};

// Get number of patients older than a specified age
const getPatientsOlderThan = async (request, response) => {
	try {
		const ageThreshold = parseInt(request.query.age); // Extract age threshold from query parameter
		if (isNaN(ageThreshold)) {
			return response.status(400).json({ error: "Invalid age threshold" });
		}
		const currentDate = new Date();
		const thresholdDate = new Date(currentDate - 1000 * 60 * 60 * 24 * 365 * ageThreshold);
		const patientsOlderThanThreshold = await Patient.countDocuments({ dob: { $lte: thresholdDate } });
		response.json({ patientsOlderThanThreshold });
	} catch (error) {
		handleError(response, error);
	}
};

// Get all patients
const getAllPatients = async (request, response) => {
	try {
		const patients = await Patient.find({})
			.populate("preExistingConditions", { icdcode: 1, disease: 1 })
			.populate("user", { email: 1, name: 1, phone: 1 });
		response.json(patients);
	} catch (error) {
		handleError(response, error);
	}
};

// Find patients by demographic data
const findPatientsByDemographic = async (req, res) => {
	const { name, ssn, dob, postalCode } = req.query;
	const query = {};

	if (ssn) {
		query.ssn = ssn;
	}
	if (dob) {
		const { startOfDay, endOfDay } = getDayRange(dob);
		query.dob = { $gte: startOfDay, $lte: endOfDay };
	}
	if (postalCode) {
		query["address.postalCode"] = postalCode;
	}

	try {
		let userQuery = {};

		if (name) {
			userQuery.name = new RegExp(name, "i"); // Case-insensitive regex search for name
		}

		// If name is provided, find matching users
		if (name) {
			const users = await User.find(userQuery, "_id").lean();
			const userIds = users.map((user) => user._id);

			// Add user IDs to the patient query
			query.user = { $in: userIds };
		}
		const patients = await Patient.find(query)
			.populate("user", "email name phone")
			.populate("preExistingConditions", { icdcode: 1, disease: 1 })
			.lean(); // Use lean to get plain JavaScript objects instead of Mongoose documents

		res.json(patients);
	} catch (error) {
		handleError(response, error);
	}
};

// Create a new patient
const createPatient = async (request, response) => {
	try {
		const { name, phone, email, password, address } = request.body;
		const { preferredLanguage, dob, sex, ssn } = request.body;

		// TODO: implement additional countries
		// assume US-only, for now
		const modifiedAddress = { ...address, country: "US" };

		// when you create a new patient,
		// you must also create a new user

		const { value: userValue, error: userError } = createUserSchema.validate({
			email,
			name,
			phone,
			password,
			role: "patient",
		});
		if (userError) {
			return handleError(response, userError, 400, userError.details[0].message);
		}

		const savedUser = await createUser(userValue);

		const patientValidation = createPatientSchema.validate({
			user: savedUser._id.toString(),
			preferredLanguage,
			dob,
			sex,
			ssn,
			address: modifiedAddress,
		});

		if (patientValidation.error) {
			return handleError(
				response,
				patientValidation.error,
				400,
				patientValidation.error.details[0].message
			);
		}

		const patient = new Patient(patientValidation.value);

		const savedPatient = await patient.save();
		loggerService.logInfo("Created new patient", { name, email });
		response.status(201).json(savedPatient);
	} catch (error) {
		handleError(response, error);
	}
};

// Update a patient
const updatePatient = async (request, response) => {
	const id = request.params.id;
	const body = request.body;

	try {
		const patient = await Patient.findById(id).populate("preExistingConditions");
		if (!patient) {
			return handleError(response, new Error("Patient not found"), 404, "Patient not found");
		}

		const { value: userValue, error: userError } = updateUserSchema.validate({
			name: body.user.name,
			email: body.user.email,
			phone: body.user.phone,
		});

		if (userError) {
			// TODO: need to handle this error gracefully on the front end when you try to update the values to something invalid
			return handleError(response, userError, 400, userError.details[0].message);
		}

		// Update the user associated with the patient
		const updatedUser = await User.findByIdAndUpdate(patient.user, userValue, { new: true });

		if (!updatedUser) {
			return response.status(404).json({ error: "User not found" });
		}

		// Update other patient fields
		patient.dob = body.dob;
		patient.ssn = body.ssn;
		patient.sex = body.sex;
		patient.preferredLanguage = body.preferredLanguage;
		patient.address = body.address;

		const { value: patientValue, error: patientError } = updatePatientSchema.validate(patient);

		if (userError) {
			return handleError(response, patientError, 400, patientError.details[0].message);
		}

		const updatedPatient = await patient.save();

		response.status(200).json(updatedPatient);
	} catch (error) {
		handleError(response, error);
	}
};

module.exports = {
	getTotalPatients,
	getPatientsOlderThan,
	getAllPatients,
	findPatientsByDemographic,
	createPatient,
	updatePatient,
};
