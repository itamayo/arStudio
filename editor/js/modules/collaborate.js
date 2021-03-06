//===================================================================================

// 		cw: This module handles everything to do with collaboration

//===================================================================================
var CollaborateModule = {
	name: "Collaborate",
	enabled: false,
	server: null,
	connected: false,

	username: "",
	room_name: "",
	server_host: null,
	server_port: 0,
	default_port: 8080,
	actions: {},

	refresh_rate: 400, //ms

	log_history: [],
	max_history: 100,
	loading_scene: false,

	settings: {
		show_cameras: true,
		username: "",
	},

	//======================================================================
	//
	//======================================================================
	init: function()
	{
		this.server = new SillyClient();

		this.room_name = ((performance.now()*100000)|0).toString(36);
		this.log("Not connected...");

		LiteGUI.bind( CORE, "user_action", function(e){
			CollaborateModule.onUserAction(e.detail);
		});

		LiteGUI.bind( CORE, "after_user_action", function(e){
			CollaborateModule.onUserAction(e.detail);
		});
	},

	//======================================================================
	// Start editing a file in collaboration mode.
	//======================================================================
	startCollaborating: function(filename)
	{
		// Remember the folder so we know where to store memory-assets from dragging stuff into the scene...
		if (!LS.GlobalScene.extra) LS.GlobalScene.extra = {};
		LS.GlobalScene.extra.folder = LS.ResourcesManager.getFolder( filename );

		CollaborateModule.collaborating=true;
		CollaborateModule.room_name = filename;
		CollaborateModule.connect(CollaborateModule.room_name);	// First thing server will do is push the scene JSON to us.
		SceneStorageModule.setCollaborating(true);	// Fixes menu items
	},

	//======================================================================
	// Stop collaborating, called from Collaborate/stop, also clears scene
	//======================================================================
	stopCollaborating: function()
	{
		CollaborateModule.collaborating=false;
		CollaborateModule.disconnect();
		//@todo close any chat window
		SceneStorageModule.setCollaborating(false);	// Fixed menu items

	},


	//======================================================================
	// Renders coloured squares showing the other collab users camera positions
	//======================================================================
	renderView: function(e, camera)
	{
		if( !this.connected || !EditorView.render_helpers || RenderModule.render_settings.in_player || !RenderModule.frame_updated )
			return;

		var ctx = gl;
		ctx.start2D();
		ctx.fillStyle = "red";

		for(var i in this.server.clients)
		{
			var user = this.server.clients[i];
			var info = user.info;
			if(!info || user.id == this.server.user_id )
				continue;

			var pos = camera.project( info.camera.eye );
		//cwx	ctx.fillRect( pos[0], gl.viewport_data[3] - pos[1], 10,10 );

			/*
			LS.Draw.push();
			LS.Draw.translate( info.camera.eye );
			LS.Draw.renderSolidSphere(1);
			LS.Draw.pop();
			*/
		}
		ctx.finish2D();
	},

	//======================================================================
	// Request an upload or download (old, unused)
	//======================================================================
	request: function( action, user )
	{
		if(!this.connected || !user )
			return this.log("not connected");

		if(action == "download")
		{
			this.server.sendMessage( { action: "request_download" }, user.id );		
		}
		else if(action == "upload")
		{
			this.sendSceneTo( user.id );
		}
	},

	//======================================================================
	// Handle message coming in from server (chat, and remote actions, eg: moved a node)
	//======================================================================
	onServerMessage: function( author_id, packet )
	{
		if(!this.server || !this.connected)
			return; //impossible

		var user = this.server.clients[ author_id ];
		var time = getTime();

		switch( packet.action )
		{
			case "chat":
				this.log( { type: "chat", user_id: user.id, username: user.name, content: packet.param } );
				break;
			case "enter":
			case "setname":
				if(user)
				{
					user.name = packet.username;
					if( packet.action == "enter" )
						this.log( { type: "connected", user_id: user.id, username: user.name } );
					else
						this.log( { type: "renamed", user_id: user.id, username: user.name } );
					this.onDataUpdated();
				}
				break;

			// Server is asking us to send our local copy of the scene.
			case "request_download":
				this.log( { type: "request", username: user.name, user_id: user.id, data: "scene" });
				this.sendSceneTo( user.id );
				break;

			// Server is giving us a new scene JSON
			case "set_scene":
				this.log( { type: "scene", username: user.name, user_id: user.id, scene: packet.scene });
				break;
			case "user_info":
				user.info = packet.info;
				break;
			case "user_action":
				this.onRemoteUserAction( packet.info, user );
				break;




			default:
				var callback = CollaborateModule.actions[ packet.action ];
				if(callback)
					callback( author_id, packet, this );
				else
					console.log("Unknown collaborate action");
		}
	},

	//======================================================================
	// Connect to the server room (room is the name of the file we're editing)
	//======================================================================
	connect: function( room_name )
	{
		console.log("COLLABORATE:connect");
		if(!room_name)
			return;

		var that = this;
		this.connected = false;

		var server_host = this.server_host;
		if(!server_host)
			server_host = location.host;
		var url = server_host + ":" + (this.server_port || this.default_port);
		this.room_name = room_name;

		if(!this.server)
			this.server = new SillyClient();
		this.server.connect( url , /*cwx "_WGLS_COLLABORATE_" + */  room_name );

		this.log("Connecting...");

		this.server.on_error = function(err){
			that.log("Error connecting");
		}

		this.server.on_room_info = this.onConnected.bind(this);

		this.server.on_user_connected = function(id){
			//that.onDataUpdated();
			this.sendMessage( { action: "enter", username: that.username }, id );
		};

		this.server.on_user_disconnected = this.onDisconnected.bind(this);

		this.server.on_close = function(){
			that.log("Disconnected");
			that.server_id = null;
			that.connected = false;
			that.onDataUpdated();
		}

		this.server.on_message = function(author_id, msg)
		{
			var packet = JSON.parse(msg);
			that.onServerMessage( author_id, packet );
		}
	},

	//======================================================================
	//
	//======================================================================
	onConnected: function(info)
	{
		this.log("Connected!");
		var id = this.server.user_id;
		if(!this.username)
			this.username = "user_" + id;
		this.server_id = id;
		this.connected = true;
		this.server.clients[ this.server.user_id ].name = this.username;
		this.onDataUpdated();
		this.server.sendMessage( { action: "enter", username: this.username } );


		//cw: on connection, if we're not the first person, ask for the scene from the first person.
		// cw: REMOVED, now server loads the JSON file and sends to everyone.
		var min_user = this.getMainUser();
		/*
		if( min_user && min_user.id != this.server.user_id )
		{
			this.log("Requesting scene to " + min_user.id );
			this.server.sendMessage( { action: "request_download", data: "scene", username: this.username }, min_user.id );
		}
		else
			this.log("You are the first user in the room.");
		*/
		LEvent.bind( LS.Renderer, "renderHelpers", this.renderView, this );
		//LEvent.bind( LS.Renderer, "renderPicking", this.renderPicking, this );

		if(this._timer)
			clearInterval( this._timer );
		this._timer = setInterval( this.onTick.bind(this), this.refresh_rate );
	},

	//======================================================================
	//
	//======================================================================
	onDisconnected: function( id )
	{
		var user = this.server.clients[ id ];
		if(!user)
			return;
		that.log( { type: "disconnected", username: user.name } );
		LEvent.unbind( LS.Renderer, "renderHelpers", this.renderView, this );
		//LEvent.unbind( LS.Renderer, "renderPicking", this.renderPicking, this );
		clearInterval( this._timer );
	},

	//======================================================================
	//
	//======================================================================
	onTick: function()
	{
		if(!this.connected || this.server.num_clients < 2)
			return;

		if(!this._user_info)
			this._user_info = {
			camera: {
				eye: [0,0,0],
				center: [0,0,0],
				fov: 90,
				type: 1
			}
		};

		//lightweight version
		var info = this._user_info;

		var camera = RenderModule.getActiveCamera();
		if(camera)
		{
			camera.getEye( info.camera.eye );
			camera.getCenter( info.camera.center );
			info.camera.fov = camera.fov;
			info.camera.type = camera.type;
		}

		this.server.sendMessage( { action: "user_info", info: info } );
		LS.GlobalScene.requestFrame();
	},


	// cw: set the scene from an incoming JSON message.
	setSceneFromJSON: function( json )
	{
		CollaborateModule.loading_scene=true;	// DONT send any change events to others while loading!
		var old_folder = LS.GlobalScene.extra.folder;	// so it doesn't get cleared by the load...
		LS.GlobalScene.setFromJSON( JSON.parse( json ) );
		LS.GlobalScene.extra.folder = old_folder;
		CollaborateModule.loading_scene=false;	// Can now send any change events to others.
	},

	//======================================================================
	//
	//======================================================================
	sendSceneTo: function( user_id )
	{
		var scene_info = JSON.stringify( LS.GlobalScene.serialize() );
		this.server.sendMessage( { action: "set_scene", scene: scene_info }, user_id );
	},

	//======================================================================
	//
	//======================================================================
	requestScene: function()
	{
		var min_user = this.getMainUser();
		if( min_user && min_user.id != this.server.user_id )
		{
			this.log("Requesting scene to " + min_user.id );
			this.server.sendMessage( { action: "request_download", data: "scene", username: this.username }, min_user.id );
		}
	},

	//======================================================================
	//
	//======================================================================
	disconnect: function()
	{
		if(!this.server)
			return;
		this.server.close();
		this.connected = false;
		this.server_id = null;
		this.log("Disconnected");
	},

	//======================================================================
	//
	//======================================================================
	getMainUser: function()
	{
		if(!this.connected)
			return null;
		var min = null;
		for(var i in this.server.clients)
		{
			var user = this.server.clients[i];
			var id = Number(user.id);
			if( !min || (id < Number(min.id) && id != this.user.id) )
				min = user;
		}
		return min;
	},

	//======================================================================
	//
	//======================================================================
	getUsers: function()
	{
		if(!this.connected)
			return [];
		return this.server.clients;
	},

	//======================================================================
	//
	//======================================================================
	onCommand: function( command )
	{
		if(command == "/clear")
		{
			this.log_history.length = 0;
			this.onDataUpdated( "log" );
		}
	},

	//======================================================================
	//
	//======================================================================
	sendChat: function( text )
	{
		if( !this.server || !this.connected )
			return this.log( "not connected" );

		var packet = {
			action: "chat",
			username: this.username,
			param: text
		};

		this.server.sendMessage( JSON.stringify(packet) );
	},

	//======================================================================
	//
	//======================================================================
	log: function( msg )
	{
		if(!msg)
			return;

		if( msg.constructor === String )
			msg = { type: 0, content: msg };

		console.log(msg);
		this.log_history.push( msg );
		if( this.log_history.length > this.max_history )
			this.log_history.shift();

		LiteGUI.trigger( this, "log_message", msg );
	},

	//======================================================================
	//
	//======================================================================
	onDataUpdated: function( info )
	{
		console.log("COLLAB:onDataUpdated:"+info);
		LiteGUI.trigger( this, "data_updated", info );
	},

	//======================================================================
	// cw: Comes here when the user did something that changed the scene.
	// The same command is then sent to the server, then pushed to clients, who then handle the same action in onRemoteUserAction (below)

	// @todo this is coming in from user_action AND after_user_action - fix that as its doing 2x the amount of calls!


	// on user action is for add node or component
	// after user action is for after a number/checkbox etc has been changed

	// if it comes in here from a user_action on a number/checkbox, the scene graph should be the same
	// so once we get checksumming in there it will only send when it needs to... make sure the check is fast, ideally we can
	// just check the node we have changed
	//======================================================================
	onUserAction: function( action )
	{
		console.log("COLLAB:onUserAction:");
		console.dir(action);
		if(!this.connected)
			return;

		// Ignore events generated while loading a scene!
		if (CollaborateModule.loading_scene) return;

		//cw: make everything "scene_modified" -> should handle everything.
		action[0]="scene_modified";

		var action_info = {
			type: action[0]
		};


		switch(action[0])
		{
			case "scene_modified": 
				action_info.data = LS.GlobalScene.serialize();
				break;
			case "node_created":
				action_info.data = action[1].serialize();
				break;
			case "node_deleted":
				//TODO
				break;
			case "node_transform":
				var node = action[1];
				action_info.node_uid = node.uid;
				action_info.data = typedArrayToArray( node.transform.data );
				break;
			case "nodes_transform":
				action_info.data = [];
				for(var i in action[1])
				{
					var node = action[1][i];
					if(node.transform)
						action_info.data.push([ node.uid, typedArrayToArray( node.transform.data ) ]);
				}
				break;
			case "material_changed":
				var material = action[1];
				action_info.material_fullpath = material.fullpath;
				action_info.material = material.serialize();
				if( material._root )
					action_info.node_uid = material._root.uid;
				break;
			case "node_material_assigned":
				var node = action[1];
				var material = action[2];
				action_info.node_uid = node.uid;
				action_info.material = (material && material.serialize) ? material.serialize() : material; //inline materials, strings or nulls
				break;
			case "component_created":
			case "component_changed":
				var component = action[1];
				var node = component._root;
				if(!node) //this happens when is something related to the root node ??
					return;
				action_info.node_uid = node.uid;
				action_info.component = component.serialize();
				action_info.component_index = node.getIndexOfComponent( component );
				break;
			case "component_deleted":
				var component = action[1];
				var node = component._root;
				action_info.node_uid = node.uid;
				action_info.component_uid = component.uid;
				break;
		}

		if(!action_info)
			return;
		this.server.sendMessage( { action: "user_action", info: action_info } );
	},

	//======================================================================
	//
	//======================================================================
	onRemoteUserAction: function( action, user )
	{
		if(!this.connected)
			return;

		var log_action = true;
		var log_param = "";

		switch( action.type )
		{
			case "scene_modified":
//				last_inspected = EditorModule.last_inspected;

				last_selection = SelectionModule.getSelectionUIds();

				last_inspected = EditorModule.inspector.instance; // cw: Remember what we WERE looking at


				CollaborateModule.loading_scene=true;	// DONT send any 'changed' events to others while loading a scene!
var oldfold = LS.GlobalScene.extra.folder;
					LS.GlobalScene.clear();	// cw: get rid of everything and load from this data...
					action.data.extra=null;	// cw: not viewpoint, user camera etc
					LS.GlobalScene.configure( action.data );
					LS.GlobalScene.loadResources(function () { console.log("loaded resources collab");});
LS.GlobalScene.extra.folder = oldfold;
				CollaborateModule.loading_scene=false;	// Can now send 'changed' events to others.

				//@todo check if the thing we were looking at has GONE

				SelectionModule.setSelectionFromUIds(last_selection);	// cw: May have been deleted!
			//	if (last_inspected!=undefined)
		//			CORE.inspect( last_inspected );	// Look at the root node.
		//		else
		//			CORE.inspect( LS.GlobalScene.root );	// Look at the root node.


				break;
			case "node_created":
				var node = new LS.SceneNode();
				node.configure( action.data );
				LS.GlobalScene.root.addChild( node );
				break;
			case "node_transform": 
				var node = LS.GlobalScene.getNode( action.node_uid );
				if(node && node.transform)
					node.transform.data = action.data;
				break;
			case "nodes_transform": 
				for(var i in action.data )
				{
					var node = LS.GlobalScene.getNode( action.data[i][0] );
					if(node && node.transform)
						node.transform.data = action.data[i][1];
				}
				break;
			case "node_material_assigned":
				var node = LS.GlobalScene.getNode( action.node_uid );
				if(!node)
					return;
				var material = null;
				if(action.material ) 
				{
					if( action.material.material_class ) //inline material
					{
						material = new LS.MaterialClasses[ action.material.material_class ];
						material.configure( action.material );
					}
					else //resource material
					{
						LS.RM.load( action.material );
						material = action.material;
					}
				}
				node.material = material;
				break;
			case "material_changed":
				var node = null;
				if( action.node_uid )
					node = LS.GlobalScene.getNode( action.node_uid );

				if( node && node.material )
				{
					node.material.configure( action.material );
					return;
				}

				LS.RM.load( action.material_fullpath, function(material){
					if( material )
						material.configure( action.material );
				});
				break;
			case "component_created":
				var node = LS.GlobalScene.getNode( action.node_uid );
				if(!node)
					return;
				var component_info = action.component;
				var component_ctor = LS.Components[ component_info.object_class ];
				if(!component_ctor)
					return;
				var component = new component_ctor();
				component.configure( component_info );
				node.addComponent( component, action.component_index );
				break;
			case "component_changed":
				var node = LS.GlobalScene.getNode( action.node_uid );
				if(!node)
					return;
				var component_info = action.component;
				var component = node.getComponentByUId( component_info.uid );
				if(!component)
					return;
				component.configure( component_info );
				log_param = " to component " + LS.getObjectClassname( component );
				break;
			case "component_deleted":
				var node = LS.GlobalScene.getNode( action.node_uid );
				if(!node)
					return;
				var component_info = action.component;
				var component = node.getComponentByUId( component_info.uid );
				if(!component)
					return;
				node.removeComponent( component );
				log_param = " to component " + LS.getObjectClassname( component );
				break;
		}

		if(log_action)
		{
			var event = { type: "user_action", user_id: user.id, username: user.name, content: action.type + log_param };
			if( ! this._last_event || (this._last_event && JSON.stringify( this._last_event ) != JSON.stringify( event )) )
				this.log( event );
			this._last_event = event;
		}

		LS.GlobalScene.requestFrame();
	}
};

//======================================================================
//
//======================================================================
CORE.registerModule( CollaborateModule );