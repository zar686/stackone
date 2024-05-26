const express = require('express');
const axios = require('axios');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());

const bamboohrApiKey = process.env.BAMBOOHR_API_KEY;
const bamboohrSubdomain = process.env.BAMBOOHR_SUBDOMAIN;

// Base URL for BambooHR API
const bamboohrBaseUrl = `https://${bamboohrSubdomain}.bamboohr.com/api/gateway.php/${bamboohrSubdomain}/v1`;

// Middleware to add authentication header
const authenticate = (req, res, next) => {
    req.headers['Authorization'] = `Basic ${Buffer.from(bamboohrApiKey + ':x').toString('base64')}`;
    next();
};

app.use(authenticate);

// Helper function to calculate tenure
const calculateTenure = (hireDate) => {
    const hire = new Date(hireDate);
    const now = new Date();
    const diff = now - hire;
    return Math.floor(diff / (1000 * 60 * 60 * 24 * 365)); // Convert milliseconds to years
};

// Helper function to fetch additional details with retry mechanism
const fetchWithRetry = async (url, headers, retries = 5, delay = 1000) => {
    try {
        return await axios.get(url, { headers });
    } catch (error) {
        if (error.response && error.response.status === 503 && retries > 0) {
            console.warn(`503 Service Unavailable. Retrying in ${delay}ms...`);
            await new Promise(resolve => setTimeout(resolve, delay));
            return fetchWithRetry(url, headers, retries - 1, delay * 2);
        }
        throw error;
    }
};

// Fetch employee data
app.get('/employees', async (req, res) => {
    const { expandManager } = req.query;
    try {
        console.log('Fetching employee data...');
        console.log('Request Headers:', {
            'Authorization': req.headers['Authorization'],
            'Accept': 'application/json'
        });

        const directoryResponse = await axios.get(`${bamboohrBaseUrl}/employees/directory`, {
            headers: {
                'Authorization': req.headers['Authorization'],
                'Accept': 'application/json'
            }
        });

        const employeesData = directoryResponse.data.employees;

        // Fetch additional details for each employee
        const employees = await Promise.all(employeesData.map(async (employee) => {
            const detailsResponse = await fetchWithRetry(
                `${bamboohrBaseUrl}/employees/${employee.id}`,
                {
                    'Authorization': `Basic ${Buffer.from(bamboohrApiKey + ':x').toString('base64')}`,
                    'Accept': 'application/json'
                }
            );

            const details = detailsResponse.data;
            const hireDate = details.hireDate || null;
            const tenure = hireDate ? calculateTenure(hireDate) : null;

            // Fetch manager details if expandManager is true
            let managerDetails = {};
            if (expandManager && employee.supervisorId) {
                const managerResponse = await fetchWithRetry(
                    `${bamboohrBaseUrl}/employees/${employee.supervisorId}`,
                    {
                        'Authorization': `Basic ${Buffer.from(bamboohrApiKey + ':x').toString('base64')}`,
                        'Accept': 'application/json'
                    }
                );
                const manager = managerResponse.data;
                managerDetails = {
                    manager_name: manager.firstName + ' ' + manager.lastName,
                    manager_job_title: manager.jobTitle
                };
            }

            return {
                id: employee.id,
                first_name: employee.firstName,
                last_name: employee.lastName,
                name: `${employee.firstName} ${employee.lastName}`,
                display_name: employee.displayName,
                date_of_birth: details.dateOfBirth ? new Date(details.dateOfBirth) : null,
                avatar_url: details.photoUrl || 'https://example.com/default-avatar.png', // Default avatar URL
                personal_phone_number: details.mobilePhone || 'N/A',
                work_email: employee.workEmail || 'N/A',
                job_title: employee.jobTitle || 'N/A',
                department: employee.department || 'N/A',
                hire_date: hireDate ? new Date(hireDate) : null,
                tenure: tenure,
                work_anniversary: hireDate ? new Date(hireDate) : null,
                employments: [
                    {
                        start_date: hireDate ? new Date(hireDate).getTime() : null,
                        title: employee.jobTitle || 'N/A',
                        manager_id: employee.supervisorId || 'N/A',
                        ...managerDetails // Include manager details if fetched
                    }
                ]
            };
        }));

        res.json(employees);
    } catch (error) {
        console.error('Error fetching employee data:', error);

        if (error.response) {
            console.error('Response error:', error.response.data);
            res.status(error.response.status).send(error.response.data);
        } else if (error.request) {
            console.error('No response received:', error.request);
            res.status(500).send('No response received from BambooHR API');
        } else {
            console.error('Request setup error:', error.message);
            res.status(500).send('Error setting up the request to BambooHR API');
        }
    }
});

app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});
