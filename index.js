const express = require('express');
const cors = require('cors');
const flightData = require('./flight.json');
const bodyParser = require('body-parser');
const fs = require('fs').promises;
const AWS = require("aws-sdk");
const s3 = new AWS.S3()

const app = express();
app.use(bodyParser.json());
const PORT = process.env.PORT || 3001;

app.use(cors());

app.get('/iataCodes', (req, res) => {
    const iataCodes = flightData.map(airport => airport.iataCode);
    res.json(iataCodes);
});

app.get('/countries', (req, res) => {
    const countries = [...new Set(flightData.map(airport => airport.country))];
    res.json(countries);
});

app.get('/cities/:country', (req, res) => {
    const country = req.params.country;
    const cities = flightData
        .filter(airport => airport.country === country)
        .map(airport => ({
            city: airport.location,
            iataCode: airport.iataCode,
        }));
    res.json(cities);
});

app.options('/generateRoutes', cors());

function generateRealisticRoutes(departure, arrival, dates) {
    const routes = [];
    const cities = flightData.map((item) => item.locationName);

    const intermediateCities = cities
        .filter(
            (city) =>
                city !== departure &&
                city !== arrival &&
                flightData.find((item) => item.locationName === city)?.country === "United States"
        )
        .map((city) => {
            const airport = flightData.find((item) => item.locationName === city);
            if (airport) {
                return `${city}-${airport.iataCode}`;
            } else {
                return city;
            }
        });

    for (let i = 0; i < 10; i++) {
        // Shuffle intermediate cities and limit to a random number between 1 and 3
        const maxIntermediates = Math.min(2, intermediateCities.length);
        const numIntermediates = Math.floor(Math.random() * maxIntermediates) + 1;
        const shuffledIntermediateCities = intermediateCities
            .sort(() => Math.random() - 0.5)
            .slice(0, numIntermediates);

            const intermediateIataCodes = shuffledIntermediateCities
            .map(city => {
                const [cityName, iataCode] = city.split('-');
                return iataCode.trim();
            })
            .filter(iataCode => iataCode.length === 3)  // Filter to include only IATA codes with length 3
            .join(',');

        const randomDeparture = departure;
        const randomArrival = arrival;
        const randomStops = shuffledIntermediateCities;

        // Calculate total stops on the card
        const totalStops = randomStops.length;

        const airlines = [
            "Alaska Airlines",
            "Delta Airlines",
            "JetBlue",
            "United Airlines"
        ];

        const randomAirline = airlines[Math.floor(Math.random() * airlines.length)];

        // Generate random departure and arrival times
        const randomDepartureTime = generateRandomTime();
        const randomArrivalTime = generateRandomTime();

        const route = {
            airlineName: randomAirline,
            departure: {
                city: randomDeparture,
                iataCode: randomDeparture.split('-')[1].trim(),
                time: randomDepartureTime,
            },
            stops: randomStops.map((stop) => ({
                city: stop,
                iataCode: stop.split('-')[1].trim(),
            })),
            arrival: {
                city: randomArrival,
                iataCode: randomArrival.split('-')[1].trim(),
                time: randomArrivalTime,
            },
            boardingTime: `${Math.floor(Math.random() * 12)}:00 PM`,
            totalCost: `$${Math.floor(Math.random() * 100) + 300}`,
            dates: dates,
            totalStops: totalStops,
            intermediateIataCodes: intermediateIataCodes,
        };

        // Calculate the difference between boarding time and arrival time
        const boardingDateTime = new Date(`2023-12-06 ${route.boardingTime}`);
        const arrivalDateTime = new Date(`2023-12-06 ${route.arrival.time}`);
        const timeDifference = arrivalDateTime - boardingDateTime;
        const totalHours = Math.abs(Math.floor(timeDifference / (1000 * 60 * 60)));
        const totalMinutes = Math.floor((timeDifference % (1000 * 60 * 60)) / (1000 * 60));
        route.totalTime = `${totalHours}h ${totalMinutes}m`;

        routes.push(route);
    }

    return routes;
}

// Function to generate a random time (HH:MM AM/PM)
function generateRandomTime() {
    const hours = Math.floor(Math.random() * 12);
    const minutes = Math.floor(Math.random() * 60);
    const amPm = Math.random() < 0.5 ? 'AM' : 'PM';

    return `${hours}:${minutes < 10 ? '0' : ''}${minutes} ${amPm}`;
}

function generateReturnRoute(departure, arrival, dates) {
    const departureRoutes = generateRealisticRoutes(departure, arrival, dates);
    const returnRoutes = generateRealisticRoutes(arrival, departure, dates);

    return [...departureRoutes, ...returnRoutes];
}

//write booking info
async function writeBookingToFile(email, bookingData) {
    try {
        // Read existing data from the file
        const data = await fs.readFile('bookings.json', 'utf-8');
        const existingData = JSON.parse(data);

        // Add or update the booking data for the provided email
        existingData[email] = bookingData;

        // Write the updated data back to the file
        await fs.writeFile('bookings.json', JSON.stringify(existingData, null, 2));
    } catch (error) {
        // If the file doesn't exist, create a new one
        const newBookingData = { [email]: bookingData };
        await fs.writeFile('bookings.json', JSON.stringify(newBookingData, null, 2));
    }
}


app.post('/generateRoutes', (req, res) => {
    const { departureCity, arrivalCity, dates, flightType } = req.body;

    try {
        let routes = [];

        if (flightType === "return") {
            routes = generateReturnRoute(departureCity, arrivalCity, dates);
        } else {
            routes = generateRealisticRoutes(departureCity, arrivalCity, dates);
        }

        res.json(routes);
        console.log(routes);
    } catch (error) {
        console.error('Error generating routes:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});



function generateConfirmationCode() {
    return Math.random().toString(36).substr(2, 6).toUpperCase();
}


async function writeBookingToS3(email, bookingData) {
    try {
        // Read existing data from S3
        const existingData = await readBookingFromS3();

        // Add or update the booking data for the provided email
        existingData[email] = bookingData;

        // Write the updated data back to S3
        await s3.putObject({
            Body: JSON.stringify(existingData),
            Bucket: "cyclic-harlequin-hermit-crab-hat-eu-west-3",
            Key: "bookings.json",
        }).promise();
    } catch (error) {
        // If the file doesn't exist, create a new one
        const newBookingData = { [email]: bookingData };
        await s3.putObject({
            Body: JSON.stringify(newBookingData),
            Bucket: "cyclic-harlequin-hermit-crab-hat-eu-west-3",
            Key: "bookings.json",
        }).promise();
    }
}

async function readBookingFromS3() {
    try {
        // Get existing data from S3
        const response = await s3.getObject({
            Bucket: "cyclic-harlequin-hermit-crab-hat-eu-west-3",
            Key: "bookings.json",
        }).promise();
        console.log(JSON.parse(response.Body.toString()),'response')
        return JSON.parse(response.Body.toString());
    } catch (error) {
        // If the file doesn't exist, return an empty object
        return {};
    }
}

app.post('/confirmBooking', async (req, res) => {
    const { firstName, lastName, email, departureCity, arrivalCity, totalTime, numStops } = req.body;

    // Check if any required information is missing
    const missingFields = [];
    if (!firstName) missingFields.push('First Name');
    if (!lastName) missingFields.push('Last Name');
    if (!email) missingFields.push('Email');
    if (!departureCity) missingFields.push('Departure');
    if (!arrivalCity) missingFields.push('Arrival');
    if (!totalTime) missingFields.push('Time');
    if (!numStops) missingFields.push('Stops');

    if (missingFields.length > 0) {
        return res.status(400).json({ error: `Missing information: ${missingFields.join(', ')}` });
    }

    // Generate confirmation code
    const confirmationCode = generateConfirmationCode();

    // Save the booking information to a file with a JSON object containing all bookings
    await writeBookingToS3(email, {
        firstName,
        lastName,
        departureCity,
        arrivalCity,
        totalTime,
        numStops,
        confirmationCode,
    });

    // Respond with confirmation code
    res.json({ confirmationCode });
});


app.post('/bookingInfo', async (req, res) => {
    const { email } = req.body;

    if (!email) {
        return res.status(400).json({ error: 'Missing email in the request payload' });
    }

    try {
        // Read data from S3
        const bookings = await readBookingFromS3();

        // Find the booking information for the provided email
        const bookingInfo = bookings[email];

        if (!bookingInfo) {
            return res.status(404).json({ error: 'Booking not found for the provided email' });
        }

        // Respond with the booking information directly (not in an array)
        res.json({ bookingInfo });
    } catch (error) {
        console.error('Error reading bookings:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});






app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
