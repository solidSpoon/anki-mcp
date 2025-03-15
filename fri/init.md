Quickstart

For Server Developers
=====================

Get started building your own server to use in Claude for Desktop and other clients.

In this tutorial, we’ll build a simple MCP weather server and connect it to a host, Claude for Desktop. We’ll start with a basic setup, and then progress to more complex use cases.

### 

[​

](#what-we%E2%80%99ll-be-building)

What we’ll be building

Many LLMs (including Claude) do not currently have the ability to fetch the forecast and severe weather alerts. Let’s use MCP to solve that!

We’ll build a server that exposes two tools: `get-alerts` and `get-forecast`. Then we’ll connect the server to an MCP host (in this case, Claude for Desktop):

![](https://mintlify.s3.us-west-1.amazonaws.com/mcp/images/weather-alerts.png)

![](https://mintlify.s3.us-west-1.amazonaws.com/mcp/images/current-weather.png)

Servers can connect to any client. We’ve chosen Claude for Desktop here for simplicity, but we also have guides on [building your own client](/quickstart/client) as well as a [list of other clients here](/clients).

Why Claude for Desktop and not Claude.ai?

Because servers are locally run, MCP currently only supports desktop hosts. Remote hosts are in active development.

### 

[​

](#core-mcp-concepts)

Core MCP Concepts

MCP servers can provide three main types of capabilities:

1.  **Resources**: File-like data that can be read by clients (like API responses or file contents)
2.  **Tools**: Functions that can be called by the LLM (with user approval)
3.  **Prompts**: Pre-written templates that help users accomplish specific tasks

This tutorial will primarily focus on tools.

*   Python
*   Node
*   Java

Let’s get started with building our weather server! [You can find the complete code for what we’ll be building here.](https://github.com/modelcontextprotocol/quickstart-resources/tree/main/weather-server-typescript)

### Prerequisite knowledge

This quickstart assumes you have familiarity with:

*   TypeScript
*   LLMs like Claude

### System requirements

For TypeScript, make sure you have the latest version of Node installed.

### Set up your environment

First, let’s install Node.js and npm if you haven’t already. You can download them from [nodejs.org](https://nodejs.org/). Verify your Node.js installation:

Copy

```
node --version
npm --version 
```

For this tutorial, you’ll need Node.js version 16 or higher.

Now, let’s create and set up our project:

MacOS/Linux

Windows

Copy

```
# Create a new directory for our project
mkdir weather
cd weather
# Initialize a new npm project
npm init -y
# Install dependencies
npm install @modelcontextprotocol/sdk zod
npm install -D @types/node typescript
# Create our files
mkdir src
touch src/index.ts 
```

Update your package.json to add type: “module” and a build script:

package.json

Copy

```
{
 "type": "module",
 "bin": {
 "weather": "./build/index.js"
 },
 "scripts": {
 "build": "tsc && chmod 755 build/index.js"
 },
 "files": [
 "build"
 ],
} 
```

Create a `tsconfig.json` in the root of your project:

tsconfig.json

Copy

```
{
 "compilerOptions": {
 "target": "ES2022",
 "module": "Node16",
 "moduleResolution": "Node16",
 "outDir": "./build",
 "rootDir": "./src",
 "strict": true,
 "esModuleInterop": true,
 "skipLibCheck": true,
 "forceConsistentCasingInFileNames": true
 },
 "include": ["src/**/*"],
 "exclude": ["node_modules"]
} 
```

Now let’s dive into building your server.

Building your server
--------------------

### Importing packages and setting up the instance

Add these to the top of your `src/index.ts`:

Copy

```
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
const NWS_API_BASE = "https://api.weather.gov";
const USER_AGENT = "weather-app/1.0";
// Create server instance
const server = new McpServer({
 name: "weather",
 version: "1.0.0",
}); 
```

### Helper functions

Next, let’s add our helper functions for querying and formatting the data from the National Weather Service API:

Copy

```
// Helper function for making NWS API requests
async function makeNWSRequest<T>(url: string): Promise<T | null> {
 const headers = {
 "User-Agent": USER_AGENT,
 Accept: "application/geo+json",
 };
 try {
 const response = await fetch(url, { headers });
 if (!response.ok) {
 throw new Error(`HTTP error! status: ${response.status}`);
 }
 return (await response.json()) as T;
 } catch (error) {
 console.error("Error making NWS request:", error);
 return null;
 }
}
interface AlertFeature {
 properties: {
 event?: string;
 areaDesc?: string;
 severity?: string;
 status?: string;
 headline?: string;
 };
}
// Format alert data
function formatAlert(feature: AlertFeature): string {
 const props = feature.properties;
 return [
 `Event: ${props.event || "Unknown"}`,
 `Area: ${props.areaDesc || "Unknown"}`,
 `Severity: ${props.severity || "Unknown"}`,
 `Status: ${props.status || "Unknown"}`,
 `Headline: ${props.headline || "No headline"}`,
 "---",
 ].join("\n");
}
interface ForecastPeriod {
 name?: string;
 temperature?: number;
 temperatureUnit?: string;
 windSpeed?: string;
 windDirection?: string;
 shortForecast?: string;
}
interface AlertsResponse {
 features: AlertFeature[];
}
interface PointsResponse {
 properties: {
 forecast?: string;
 };
}
interface ForecastResponse {
 properties: {
 periods: ForecastPeriod[];
 };
} 
```

### Implementing tool execution

The tool execution handler is responsible for actually executing the logic of each tool. Let’s add it:

Copy

```
// Register weather tools
server.tool(
 "get-alerts",
 "Get weather alerts for a state",
 {
 state: z.string().length(2).describe("Two-letter state code (e.g. CA, NY)"),
 },
 async ({ state }) => {
 const stateCode = state.toUpperCase();
 const alertsUrl = `${NWS_API_BASE}/alerts?area=${stateCode}`;
 const alertsData = await makeNWSRequest<AlertsResponse>(alertsUrl);
 if (!alertsData) {
 return {
 content: [
 {
 type: "text",
 text: "Failed to retrieve alerts data",
 },
 ],
 };
 }
 const features = alertsData.features || [];
 if (features.length === 0) {
 return {
 content: [
 {
 type: "text",
 text: `No active alerts for ${stateCode}`,
 },
 ],
 };
 }
 const formattedAlerts = features.map(formatAlert);
 const alertsText = `Active alerts for ${stateCode}:\n\n${formattedAlerts.join("\n")}`;
 return {
 content: [
 {
 type: "text",
 text: alertsText,
 },
 ],
 };
 },
);
server.tool(
 "get-forecast",
 "Get weather forecast for a location",
 {
 latitude: z.number().min(-90).max(90).describe("Latitude of the location"),
 longitude: z.number().min(-180).max(180).describe("Longitude of the location"),
 },
 async ({ latitude, longitude }) => {
 // Get grid point data
 const pointsUrl = `${NWS_API_BASE}/points/${latitude.toFixed(4)},${longitude.toFixed(4)}`;
 const pointsData = await makeNWSRequest<PointsResponse>(pointsUrl);
 if (!pointsData) {
 return {
 content: [
 {
 type: "text",
 text: `Failed to retrieve grid point data for coordinates: ${latitude}, ${longitude}. This location may not be supported by the NWS API (only US locations are supported).`,
 },
 ],
 };
 }
 const forecastUrl = pointsData.properties?.forecast;
 if (!forecastUrl) {
 return {
 content: [
 {
 type: "text",
 text: "Failed to get forecast URL from grid point data",
 },
 ],
 };
 }
 // Get forecast data
 const forecastData = await makeNWSRequest<ForecastResponse>(forecastUrl);
 if (!forecastData) {
 return {
 content: [
 {
 type: "text",
 text: "Failed to retrieve forecast data",
 },
 ],
 };
 }
 const periods = forecastData.properties?.periods || [];
 if (periods.length === 0) {
 return {
 content: [
 {
 type: "text",
 text: "No forecast periods available",
 },
 ],
 };
 }
 // Format forecast periods
 const formattedForecast = periods.map((period: ForecastPeriod) =>
 [
 `${period.name || "Unknown"}:`,
 `Temperature: ${period.temperature || "Unknown"}°${period.temperatureUnit || "F"}`,
 `Wind: ${period.windSpeed || "Unknown"}  ${period.windDirection || ""}`,
 `${period.shortForecast || "No forecast available"}`,
 "---",
 ].join("\n"),
 );
 const forecastText = `Forecast for ${latitude}, ${longitude}:\n\n${formattedForecast.join("\n")}`;
 return {
 content: [
 {
 type: "text",
 text: forecastText,
 },
 ],
 };
 },
); 
```

### Running the server

Finally, implement the main function to run the server:

Copy

```
async function main() {
 const transport = new StdioServerTransport();
 await server.connect(transport);
 console.error("Weather MCP Server running on stdio");
}
main().catch((error) => {
 console.error("Fatal error in main():", error);
 process.exit(1);
}); 
```

Make sure to run `npm run build` to build your server! This is a very important step in getting your server to connect.

Let’s now test your server from an existing MCP host, Claude for Desktop.

Testing your server with Claude for Desktop
-------------------------------------------

Claude for Desktop is not yet available on Linux. Linux users can proceed to the [Building a client](/quickstart/client) tutorial to build an MCP client that connects to the server we just built.

First, make sure you have Claude for Desktop installed. [You can install the latest version here.](https://claude.ai/download) If you already have Claude for Desktop, **make sure it’s updated to the latest version.**

We’ll need to configure Claude for Desktop for whichever MCP servers you want to use. To do this, open your Claude for Desktop App configuration at `~/Library/Application Support/Claude/claude_desktop_config.json` in a text editor. Make sure to create the file if it doesn’t exist.

For example, if you have [VS Code](https://code.visualstudio.com/) installed:

*   MacOS/Linux
*   Windows

Copy

```
code ~/Library/Application\ Support/Claude/claude_desktop_config.json 
```

You’ll then add your servers in the `mcpServers` key. The MCP UI elements will only show up in Claude for Desktop if at least one server is properly configured.

In this case, we’ll add our single weather server like so:

*   MacOS/Linux
*   Windows

Node

Copy

```
{
 "mcpServers": {
 "weather": {
 "command": "node",
 "args": [
 "/ABSOLUTE/PATH/TO/PARENT/FOLDER/weather/build/index.js"
 ]
 }
 }
} 
```

This tells Claude for Desktop:

1.  There’s an MCP server named “weather”
2.  Launch it by running `node /ABSOLUTE/PATH/TO/PARENT/FOLDER/weather/build/index.js`

Save the file, and restart **Claude for Desktop**.

### 

[​

](#test-with-commands)

Test with commands

Let’s make sure Claude for Desktop is picking up the two tools we’ve exposed in our `weather` server. You can do this by looking for the hammer ![](https://mintlify.s3.us-west-1.amazonaws.com/mcp/images/claude-desktop-mcp-hammer-icon.svg)
 icon:

![](https://mintlify.s3.us-west-1.amazonaws.com/mcp/images/visual-indicator-mcp-tools.png)

After clicking on the hammer icon, you should see two tools listed:

![](https://mintlify.s3.us-west-1.amazonaws.com/mcp/images/available-mcp-tools.png)

If your server isn’t being picked up by Claude for Desktop, proceed to the [Troubleshooting](/quickstart/server#troubleshooting) section for debugging tips.

If the hammer icon has shown up, you can now test your server by running the following commands in Claude for Desktop:

*   What’s the weather in Sacramento?
*   What are the active weather alerts in Texas?

![](https://mintlify.s3.us-west-1.amazonaws.com/mcp/images/current-weather.png)

![](https://mintlify.s3.us-west-1.amazonaws.com/mcp/images/weather-alerts.png)

Since this is the US National Weather service, the queries will only work for US locations.

[​

](#what%E2%80%99s-happening-under-the-hood)

What’s happening under the hood
----------------------------------------------------------------------------------

When you ask a question:

1.  The client sends your question to Claude
2.  Claude analyzes the available tools and decides which one(s) to use
3.  The client executes the chosen tool(s) through the MCP server
4.  The results are sent back to Claude
5.  Claude formulates a natural language response
6.  The response is displayed to you!

[​

](#troubleshooting)

Troubleshooting
------------------------------------------

Claude for Desktop Integration Issues

**Getting logs from Claude for Desktop**

Claude.app logging related to MCP is written to log files in `~/Library/Logs/Claude`:

*   `mcp.log` will contain general logging about MCP connections and connection failures.
*   Files named `mcp-server-SERVERNAME.log` will contain error (stderr) logging from the named server.

You can run the following command to list recent logs and follow along with any new ones:

Copy

```
# Check Claude's logs for errors
tail -n 20 -f ~/Library/Logs/Claude/mcp*.log 
```

**Server not showing up in Claude**

1.  Check your `claude_desktop_config.json` file syntax
2.  Make sure the path to your project is absolute and not relative
3.  Restart Claude for Desktop completely

**Tool calls failing silently**

If Claude attempts to use the tools but they fail:

1.  Check Claude’s logs for errors
2.  Verify your server builds and runs without errors
3.  Try restarting Claude for Desktop

**None of this is working. What do I do?**

Please refer to our [debugging guide](/docs/tools/debugging) for better debugging tools and more detailed guidance.

Weather API Issues

**Error: Failed to retrieve grid point data**

This usually means either:

1.  The coordinates are outside the US
2.  The NWS API is having issues
3.  You’re being rate limited

Fix:

*   Verify you’re using US coordinates
*   Add a small delay between requests
*   Check the NWS API status page

**Error: No active alerts for \[STATE\]**

This isn’t an error - it just means there are no current weather alerts for that state. Try a different state or check during severe weather.

For more advanced troubleshooting, check out our guide on [Debugging MCP](/docs/tools/debugging)

[​

](#next-steps)

Next steps
--------------------------------

[

Building a client
-----------------

Learn how to build your own MCP client that can connect to your server







](/quickstart/client)[

Example servers
---------------

Check out our gallery of official MCP servers and implementations







](/examples)[

Debugging Guide
---------------

Learn how to effectively debug MCP servers and integrations







](/docs/tools/debugging)[

Building MCP with LLMs
----------------------

Learn how to use LLMs like Claude to speed up your MCP development







](/tutorials/building-mcp-with-llms)

Was this page helpful?

YesNo

[Introduction](/introduction)[For Client Developers](/quickstart/client)

[github](https://github.com/modelcontextprotocol)