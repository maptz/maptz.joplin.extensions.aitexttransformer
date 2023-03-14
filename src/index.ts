import joplin from 'api';
import JoplinViewsDialogs from 'api/JoplinViewsDialogs';
import { MenuItemLocation, ToolbarButtonLocation } from 'api/types';
import { ContentScriptType } from 'api/types';
import { SettingItemType, SettingItemSubType, ButtonSpec } from 'api/types';

//Compile using `npm run dist`
//Run Dev & "C:\Program Files\Joplin\Joplin.exe" --env dev

/* #region Members */
let transformTextDialogHandle: string | null;
let confirmDialogHandle: string | null;
const defaultFullPrompt = "Make the text following the --- {0}. Return only the revised text without the --- in your response and nothing else.\r\n---\r\n{1}";
const pluginFriendlyName = "AI Text Transformer"
const pluginName = "aitexttransformer"
/* #endregion */

/* #region Methods */
function doTransform(prompt: string, apiKey: string) {
	const p = new Promise<{ success: Boolean, result: string, tokenCount: number }>(resolve => {
		callOpenAIMethod(prompt, apiKey).catch((reason) => {
			resolve({ success: false, result: "", tokenCount: 0 });
		}).then((val: any) => {
			const trimmedContent = val.choices[0].message.content.trim();
			resolve({ success: true, result: trimmedContent, tokenCount: val.usage.total_tokens });
		});
	});
	return p;
}

async function callOpenAIMethod(prompt: string, apiKey: string) {


	console.log("Calling prompt with " + prompt);
	console.log("Calling prompt with apiKey " + apiKey);
	const url = "https://api.openai.com/v1/chat/completions";

	const myData = {
		model: "gpt-3.5-turbo",
		messages: [
			{
				role: "user",
				content: prompt
			}
		]
	};

	//npm install node-fetch@2
	const response = await fetch(url, {
		method: 'POST',
		headers: {
			// eslint-disable-next-line @typescript-eslint/naming-convention
			'Accept': 'application/json',
			// eslint-disable-next-line @typescript-eslint/naming-convention
			'Content-Type': 'application/json',
			// eslint-disable-next-line @typescript-eslint/naming-convention
			'Authorization': `Bearer ${apiKey}`,
		},
		body: JSON.stringify(myData),
	})
	console.log("POST return " + response.status);
	if (response.status === 200) {
		var json = await response.json();
		return json;
	}

	throw new Error(`Failed to speak to Open AI service. Response code ${response.status}`);

}

async function showAPanel() {
	// Register a new panel
	const panel = await joplin.views.panels.create('myPanel');

	// Set some HTML to it
	await joplin.views.panels.setHtml(panel, '<button id="myButton">Click Me</button>');

	// Add a click event listener
	await joplin.views.panels.onMessage(panel, (message) => {
		if (message.id === 'myButton') {
			alert('You clicked me!');
			joplin.views.panels.hide(panel);
		}
	});
}

const transformText = async (noteId: string, forceUpdate: boolean) => {
	const args = ["notes", noteId];
	console.debug("Args", args);
	const note = await joplin.data.get(args, {
		fields: ["id", "title"],
	});

	console.debug("Event was triggered for note: ", note.id);
	console.debug("Queried note: ", note);

	const apiKey = await joplin.settings.value('apiKey');
	console.log(`Api Key: ${apiKey}`);

	const selectedText = (await joplin.commands.execute('selectedText') as string);
	const len_selection = selectedText.length;


	const dialogs = joplin.views.dialogs;

	var choiceList: ButtonSpec[] = [{ id: 'yes', title: 'Yes' }, { id: 'no', title: 'No' }];

	if (confirmDialogHandle == null) {
		confirmDialogHandle = await dialogs.create('completeLinkDialog');

		await dialogs.setHtml(confirmDialogHandle, "Are you sure you want to proceed?");
		await dialogs.setButtons(confirmDialogHandle, choiceList);
	}

	const choice = await dialogs.open(confirmDialogHandle);
	if (choice.id !== 'yes') {
		console.info("User action cancelled.");
		return;
	}

	const transformCommand = await joplin.settings.value('defaultTransform');
	if (transformTextDialogHandle == null) {
		const tempDialogHandle = await dialogs.create('myid');
		transformTextDialogHandle = tempDialogHandle;

		var transformButtons: ButtonSpec[] = [{ id: 'ok', title: 'Ok' }, { id: 'cancel', title: 'Cancel' }];
		//Button behaviour in dialogs - https://joplinapp.org/api/references/plugin_api/classes/joplinviewsdialogs.html
		//Effectively, you can only 
		await dialogs.setHtml(transformTextDialogHandle, `
	
		<div class="joplin-note-ext-dialog" style="display:inline-flex; width:200px;">
			<form name="transformForm">
				<div style="margin-bottom: 12px">
					<label style="min-width:fit-content; margin:auto; padding-right:5px; margin-bottom: 12px">Describe the update:</label>
					<div>Alt+I</div>
				</div>
				<input type="text" id="transform" name="transform" value="${transformCommand}" style="width:90vw; margin-bottom: 12px">
				<div  style="margin-bottom: 12px">
			  		<label style="font-size: 10px">e.g. more casual</label>
			  	</div>
				  <input type="submit" name="submit_button" value="Submit">         
 <input type="submit" name="submit_button" value="Cancel">  
		  </form>
		</div>
		<script>
			window.addEventListener("load", function() {
				document.getElementById("transform").focus();
			  });
			document.addEventListener("keydown", function(event) {
				if (event.key == "I" && event.altKey) {
				  document.getElementById("transform").focus();
				  //document.getElementById("myForm").submit();
				}
			  });
		</script>
	  `);

		await showAPanel();

		await dialogs.setFitToContent(transformTextDialogHandle, true);
		/*
		According to the Joplin Plugin API Documentation1, dialogs have a fixed width of 200 and a height that is automatically adjusted up to 670px. You cannot set the dialog size directly, but you can change the size of the element with ID “joplin-plugin-content” in your webview, and the dialog should resize accordingly23.
		
		You can also add a CSS file to your dialog using await joplin.views.dialogs.addScript(dialogEdit, './webview_dialog.css')3 and style your content as you wish.
		*/
	}


	const dialResult = await dialogs.open(transformTextDialogHandle);
	console.log("dial result");
	console.log(dialResult);
	if (dialResult.id !== 'ok') {
		
		console.log("User pressed cancel.");
		return;
	}

	const transformText = dialResult.formData.transformForm.transform as string;
	if (!transformText) {
		console.info("No transform data provided.");
		return;
	}
	let fullPrompt = await joplin.settings.value('defaultFullPrompt');

	fullPrompt = fullPrompt.replace("{0}", transformCommand);
	fullPrompt = fullPrompt.replace("{1}", selectedText);

	console.log("Transforming selected text");
	const result = await doTransform(fullPrompt, apiKey);
	console.log("Received result");
	await joplin.commands.execute('replaceSelection', result.result);
};

/* #endregion */

joplin.plugins.register({
	onStart: async function () {
		console.log("Registering aitexttransformer plugin");
		debugger;


		/* #region Settings */
		await joplin.settings.registerSection('myCustomSection', {
			label: 'AI Text Transform',
			iconName: 'fas fa-music',
		});

		await joplin.settings.registerSettings({

			'serviceMode': {
				value: 'OpenAI',
				type: SettingItemType.String,
				section: 'myCustomSection',
				isEnum: true,
				public: true,
				label: 'Service',
				options: {
					'OpenAI': 'OpenAI',
					'Other': 'Other',
				},
			},

			'apiKey': {
				value: '',
				type: SettingItemType.String,
				section: 'myCustomSection',
				public: true,
				secure: true,
				label: 'API Key',
			},

			'defaultTransform': {
				value: 'more casual',
				type: SettingItemType.String,
				section: 'myCustomSection',
				public: true,
				label: 'The default text transform',
				description: 'The transformation used by default',
				// ['storage' as any]: 2, // Should be `storage: SettingStorage.File`
			},

			'defaultFullPrompt': {
				value: defaultFullPrompt,
				type: SettingItemType.String,
				section: 'myCustomSection',
				public: true,
				label: 'The default full prompt',
				description: 'The full prompt',
				// ['storage' as any]: 2, // Should be `storage: SettingStorage.File`
			}
		});
		/* #endregion */

		console.info(`${pluginFriendlyName} plugin started.`);
		//Settings
		//https://joplinapp.org/api/references/plugin_api/classes/joplinsettings.html
		//An enum value here: https://discourse.joplinapp.org/t/how-to-create-dropdown-in-plugin-settings/13867/4

		/* #region Commands */
		console.log("Registering command: `transformText`");
		await joplin.commands.register({
			name: "transformText",
			label: "Transform Text",
			iconName: 'fas fa-music',
			execute: async (_noteIds: string[]) => {
				const note = await joplin.workspace.selectedNote();
				console.info("transformSelectedText called with note ", note.id);
				await transformText(note.id, true);
			},
		});

		await joplin.views.toolbarButtons.create('transformTextViaToolbarButtons', 'transformText', ToolbarButtonLocation.EditorToolbar);

		await joplin.views.menuItems.create('transformTextViaMenuItems', 'transformText', MenuItemLocation.EditorContextMenu, { accelerator: "Ctrl+Shift+M" });

		await joplin.views.menus.create('transformTextViaMenu', 'Transform Text', [
			{
				commandName: "transformText",
				accelerator: "Ctrl+Shift+m"
			}
		]);

		await joplin.contentScripts.register(
			ContentScriptType.CodeMirrorPlugin,
			'cmLineNumbers',
			'./cmLineNumbers.js'
		);

		/* #endregion */
	},
});
