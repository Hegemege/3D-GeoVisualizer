
$(document).ready(function() {
	init();
	render();
});

function init() {
	//problems with webgl/js etc handled
	if ( ! Detector.webgl ) Detector.addGetWebGLMessage();

	//general event listeners
	window.addEventListener( 'resize', onWindowResize, false );

	//threejs init
	scene = new THREE.Scene(); 
	camera = new THREE.PerspectiveCamera( 45, window.innerWidth / window.innerHeight, 0.1, 1000000 ); 
	//camera = new THREE.OrthographicCamera( window.innerWidth / - 2, window.innerWidth / 2, window.innerHeight / 2, window.innerHeight / - 2, -1, 1000 );
	renderer = new THREE.WebGLRenderer({ alpha: true }); 
	renderer.setSize( window.innerWidth, window.innerHeight ); 
	document.body.appendChild( renderer.domElement );

	renderer.setClearColor( 0xaaaaaa, 1 );

	//fps stats
	stats = new Stats();
	stats.setMode(0);
	stats.domElement.style.position = 'absolute';
	stats.domElement.style.left = '0px';
	stats.domElement.style.top = '0px';
	document.body.appendChild( stats.domElement );

	//renderer stats
	rendererStats   = new THREEx.RendererStats();
	rendererStats.domElement.style.position = 'absolute';
	rendererStats.domElement.style.left = '0px';
	rendererStats.domElement.style.bottom   = '0px';
	document.body.appendChild( rendererStats.domElement );

	//controls
	controls = new THREE.OrbitControls( camera );
	controls.damping = 0.2;
	//controls.noPan = true;
	//controls.minDistance = 10000;
	//controls.maxDistance = 150000;
	controls.maxPolarAngle = Math.PI/2; 

	camera.position.set(-110, 12, -28);
	camera.lookAt(new THREE.Vector3())

	controls.update();
	//DEBUG? controls.addEventListener( 'change', render );

	//Content inits
	//load and init geojson
	var time, now;

	time = new Date().getTime();
	loadGeoJSON(processGeoJSON); //callback
	now = new Date().getTime();
	console.log("Loading geojson took " + (now - time) + " ms");
	
	//other threejs models/lights etc
	scene_light = new THREE.PointLight( 0xffffff, 2, 0 );
	scene_light.pivot = new THREE.Vector3(); //overwritten later

	var ambientLight = new THREE.AmbientLight( 0x111111 );
	scene.add( ambientLight );

	//global scaling (the width of the map) to be used in positioning other objects
	relativeScale = 1;


	//timing
	curtime = new Date().getTime();
	dt = 0;

	//animation counter
	anim_tick = 0;

	update();
}

//helper function
function onWindowResize() {
	camera.aspect = window.innerWidth / window.innerHeight;
	camera.updateProjectionMatrix();

	renderer.setSize( window.innerWidth, window.innerHeight );

	render();

}

//stock update and render functions
function update() {
	mainloop();
	requestAnimationFrame( update ); 
	controls.update();
	render();
}

function render() {
	renderer.render( scene, camera );
	stats.update();
	rendererStats.update(renderer);
}

//animation functionality etc
function mainloop() {
	//update timers
	dt = new Date().getTime() - curtime;
	curtime = new Date().getTime();
	anim_tick += dt;

	//animations
	//rotating light
	var newpos = scene_light.pivot.clone();
	var light_radius = relativeScale*2;
	newpos.setX( scene_light.pivot.x + light_radius*Math.cos(anim_tick/1000) );
	newpos.setZ( scene_light.pivot.z + light_radius*Math.sin(anim_tick/1000) );
	scene_light.position.copy( newpos );

	if (anim_tick %100 == 0) {
		//console.log(camera.position.x, camera.position.y, camera.position.z);
	}
}

function loadGeoJSON(callback) {
	$.getJSON("data/kuntarajat-ok.geojson", callback);
}

function processGeoJSON(data) {
	//timing
	var time = new Date().getTime();

	m_data = {}; //global var!
	m_data["areas"] = [];

	//projections used in proj4js
	proj4.defs([
	  [
	    'EPSG:4326',
	    "+proj=longlat +ellps=WGS84 +datum=WGS84 +no_defs"],

	  [
	    'EPSG:3067',
	    "+proj=utm +zone=35 +ellps=GRS80 +units=m +no_defs"
	  ]
	]);

	// could be redundant to custom parse the json, but at least this approach converts the values to a proper coordinate system
	$.each(data.features, function(key, val) { //indices in the master list
		var n_entry = {}; 
		n_entry["name"] = val.properties.name;
		n_entry["code"] = val.properties.code;
		n_entry["geometry"] = [];

		//parse geometrygroups and polygons differently
		if (val.geometry.type === "Polygon") {
			n_entry["type"] = "Polygon";
			for (var i = 0; i < val.geometry.coordinates[0].length; ++i) {

				var lat = val.geometry.coordinates[0][i][0];
				var lon = val.geometry.coordinates[0][i][1];

				var result = proj4(proj4("EPSG:4326"), proj4("EPSG:3067"), [lat, lon]);
				n_entry["geometry"].push(result);
			}
		} else if (val.geometry.type === "GeometryCollection") { //islands and such that contain multiple polygons
			n_entry["type"] = "GeometryCollection";
			for (var i = 0; i < val.geometry.geometries.length; ++i) { //GeometryCollections inside GeometryCollections
				var geometry_builder = [];
				for (var j = 0; j < val.geometry.geometries[i].coordinates[0].length; ++j) {

					var lat = val.geometry.geometries[i].coordinates[0][j][0];
					var lon = val.geometry.geometries[i].coordinates[0][j][1];

					var result = proj4(proj4("EPSG:4326"), proj4("EPSG:3067"), [lat, lon]);
					geometry_builder.push(result);
				}
				n_entry["geometry"].push(geometry_builder);
			}
		} //shouldnt be other types
		m_data["areas"].push(n_entry);
	});

	//console.log(m_data);
	
	createMesh();								//create the mesh
	scaleMesh();
	data_bb = new THREE.Box3();					//generate a bounding box so the camera can center
	data_bb.setFromObject(vis_model);			
	controls.center.copy( data_bb.center() );

	//figure out relative scale from the BB, as the shorter axis to be used in positioning other elements
	if (data_bb.max.x - data_bb.min.x < data_bb.max.z - data_bb.min.z) {
		relativeScale = data_bb.max.x - data_bb.min.x 
	} else {
		relativeScale = data_bb.max.z - data_bb.min.z 
	}

	//create adds
	createGrid();								//create the plane grid lines based on data_bb
	createLight(); 								//create a light source circling above the BB
	createBase();								//creates a base for the map

	console.log("Processing the geojson into a 3D model took " + (new Date().getTime() - time) + " ms");

	//Get data
	getData(scaleAreas);


	//scale controls
	controls.minDistance = relativeScale/2;
	controls.maxDistance = relativeScale*10;


	//camera.position.set(new THREE.Vector3(20, 20, 20));
	//camera.lookAt(new THREE.Vector3(0, 0, 0));

	//debug
	/*console.log(relativeScale);
	console.log(vis_model);
	console.log(controls);
	var bbox = new THREE.BoundingBoxHelper( vis_model, 0xff0000 );
	bbox.update();
	scene.add( bbox );*/
}

function createMesh() {
	//generates the base outline geometry
	vis_model = new THREE.Object3D();
	//m_data is now filled with all the converted data from the geojson
	var materials = [];
	var material = new THREE.MeshLambertMaterial( {color: 0x00ff00, wireframe: false, shading: THREE.FlatShading, side: THREE.BackSide} );
	for (var i = 0; i < m_data.areas.length; ++i) { //each municipality
		if (m_data.areas[i].type === "Polygon") {
			var line_geometry = [];
			for (var j = 0; j < m_data.areas[i].geometry.length; ++j) { //each vertex
				var x, y, z;
				
				x = m_data.areas[i].geometry[j][0];
				y = 0;
				z = m_data.areas[i].geometry[j][1];

				line_geometry.push(new THREE.Vector2(-x, z).multiplyScalar(0.0001) );
			}
			var shape = new THREE.Shape(line_geometry);
			var geometry = new THREE.ExtrudeGeometry(shape, { amount: -0.1, bevelEnabled: false });
			
			geometry.computeFaceNormals();
			geometry.computeVertexNormals();
			
			for (var ind = 0; ind < geometry.faces.length; ++ind) {
				geometry.faces[ind].materialIndex = 0;
			}
			var polygon = new THREE.Mesh( geometry, material.clone() );

			//copy the identifiers from m_data to polygon
			polygon.name = m_data.areas[i].name;
			polygon.code = m_data.areas[i].code;

			vis_model.add(polygon);

		} else if ( m_data.areas[i].type === "GeometryCollection" ) {
			var collection = new THREE.Object3D(); //a single municipality, but this contains the islands' line geometry in its children

			for (var j = 0; j < m_data.areas[i].geometry.length; ++j) { //array of islands
				var line_geometry = [];
				for (var k = 0; k < m_data.areas[i].geometry[j].length; ++k) { //each vertex of one island
					var x, y, z; //same as above

					x = m_data.areas[i].geometry[j][k][0];
					y = 0;
					z = m_data.areas[i].geometry[j][k][1];

					line_geometry.push( new THREE.Vector2( -x, z ).multiplyScalar(0.0001) );
				}
				var shape = new THREE.Shape(line_geometry);
				var geometry = new THREE.ExtrudeGeometry(shape, { amount: -0.1, bevelEnabled: false });
				
				geometry.computeFaceNormals();
				geometry.computeVertexNormals();
				
				for (var ind = 0; ind < geometry.faces.length; ++ind) {
					geometry.faces[ind].materialIndex = 0;
				}
				var polygon = new THREE.Mesh( geometry, material.clone() );
				collection.add(polygon);
			}
			collection.name = m_data.areas[i].name;
			collection.code = m_data.areas[i].code;

			vis_model.add(collection);
		} //shouldnt be any other types
	}
	//vis_model.rotation.y = -Math.PI/2;
	vis_model.rotation.z = Math.PI/2;
	vis_model.rotation.x = Math.PI/2;
	//apply rotations

	scene.add(vis_model);
}

function scaleMesh() {
	//reposition the mesh at origin and rescale it to nicer proportions
	var BB = new THREE.Box3();	 //figure out the dimensions and scaling needed
	BB.setFromObject(vis_model);

	var width = BB.max.x - BB.min.x;
	var length = BB.max.z - BB.min.z;

	vis_model.position.copy( new THREE.Vector3(-width/2.0, 0, -length/2.0) );

	//scaling
	var target_width = 10;
	var s = target_width/width;
	vis_model.scale.set(s, s, s);

}

function createGrid() {
	//fit a grid to data_bb's lower plane
	//put grid_linecount lines on the shorter axis, which determines the grid cell sizing (which is square)

	var y = data_bb.min.y - relativeScale/100; //the grid is usually at y=0, always extending to x and z

	var startx = data_bb.min.x;
	var startz = data_bb.min.z;
	var endx = data_bb.max.x;
	var endz = data_bb.max.z;

	var width = data_bb.max.x - data_bb.min.x;
	var length = data_bb.max.z - data_bb.min.z;

	var grid_margin = 0.4; //how far the grid extends outside the BB, percentage

	//adjust the start and end coordinates according to the buffer
	startx	-= width 	* grid_margin;
	startz 	-= length 	* grid_margin;
	endx 	+= width 	* grid_margin;
	endz 	+= length 	* grid_margin;

	//recalibrate
	width = endx - startx;
	length = endz - startz;

	//Grid config
	var grid_linecount_x, grid_linecount_z;
	var stepsize; //step size for each grid increment, use the same for both dimensions
	var lines_per_short_axis = 10;

	if (width < length) {
		grid_linecount_x = lines_per_short_axis; 
		stepsize = width / grid_linecount_x;
		grid_linecount_z = Math.floor(length / stepsize);
		endz = startz + stepsize * grid_linecount_z;
	} else {
		grid_linecount_z = lines_per_short_axis;
		stepsize = length / grid_linecount_z;
		grid_linecount_x = Math.floor(width / stepsize);
		endx = startx + stepsize * grid_linecount_x;
	}
	//recalibrate, not used later though
	width = endx - startx;
	length = endz - startz;

	var material = new THREE.LineBasicMaterial( {color: 0x007700} );
	var geometry = new THREE.Geometry();

	//create the grid
	for (var i = 0; i < grid_linecount_x+1; ++i) { //+1 for the last line bit in the grid
		geometry.vertices.push( new THREE.Vector3( startx + i*stepsize, y, startz) );
		geometry.vertices.push( new THREE.Vector3( startx + i*stepsize, y, endz) );
	}

	for (var i = 0; i < grid_linecount_z+1; ++i) { //+1 for the last line bit in the grid
		geometry.vertices.push( new THREE.Vector3( startx, y, startz + i*stepsize) );
		geometry.vertices.push( new THREE.Vector3( endx, y, startz + i*stepsize) );
	}

	geometry.computeLineDistances();

	var grid_object = new THREE.Line( geometry, material, THREE.LinePieces);
	scene.add( grid_object );

}

function createLight() {
	//already created in init
	var pos = data_bb.center().clone();
	pos.y += relativeScale;
	scene_light.position.copy( pos );
	scene_light.pivot = pos; //custom variable
	scene.add( scene_light );

	var geometry = new THREE.SphereGeometry( relativeScale/100, 32, 32 );
	var material = new THREE.MeshBasicMaterial( {color: 0xffff00} );
	var sphere = new THREE.Mesh( geometry, material );
	scene_light.add( sphere ); //binds them together
}

function createBase() {
	var geometry = new THREE.PlaneGeometry( data_bb.max.x - data_bb.min.x, data_bb.max.z - data_bb.min.z );
	var material = new THREE.MeshPhongMaterial( {color: 0x444444, side: THREE.DoubleSide, opacity: 0.5, transparent: true} );
	var plane = new THREE.Mesh( geometry, material );
	plane.position.copy(data_bb.center());
	plane.rotation.x = Math.PI/2;
	plane.position.y = 0;//-relativeScale/100;
	scene.add( plane );
}

function getData(callback) {
	//DUMMY
	//for (var i = 0; i < m_data.areas.length; ++i) {
	//	m_data.areas[i].data = Math.random()*100;
	//}
	//put this into the callback of the AJAX call

	$.getJSON("data/2011-tyottomyys.json", function(data) {	
		for (var i = 0; i < m_data.areas.length; ++i) {
			m_data.areas[i].data = data[m_data.areas[i].code];
		}

		callback();
	});

}

function scaleAreas() {
	//Scale the area heights according to the min and max values
	//initialize with first value
	var data_min = m_data.areas[0].data;
	var data_max = m_data.areas[0].data;
	//find min and amx
	for (var i = 0; i < m_data.areas.length; ++i){
		if (m_data.areas[i].data < data_min) {
			data_min = m_data.areas[i].data;
		}
		if (m_data.areas[i].data > data_max) {
			data_max = m_data.areas[i].data;
		}
	}

	//parameters
	var lowestscale = 1;
	var largestscale = 50;
	var lowestcolor = new THREE.Color(0, 1, 0);
	var middlecolor = new THREE.Color(1, 1, 1);
	var highestcolor = new THREE.Color(1, 0, 0);

	var linear = true;
	var exponential = false;
	var useMiddleColor = true;

	var scales_for_names = {};
	var colors_for_names = {};

	for (var i = 0; i < m_data.areas.length; ++i) {
		var d = m_data.areas[i].data;

		d -= data_min; //normalize to 0-based rather than min-based
		var p = d/(data_max - data_min); //percentage in [min, max]
		var scale = lowestscale + p*(largestscale - lowestscale); //the real scale, in [lowestscale, largestscale]
		//finally apply the scale to the area
		scales_for_names[m_data.areas[i].name] = scale;
		colors_for_names[m_data.areas[i].name] = lowestcolor.clone().lerp(highestcolor, p);
	}

	//rescale and recolor the model
	$.each(vis_model.children, function(key, val) {
		val.scale.set(1, 1, scales_for_names[val.name] );

		if ("material" in val) {
			val.material.color.copy( colors_for_names[val.name] );
			val.material.needsUpdate = true;

		} else { //group
			$.each(val.children, function(key2, val2) {
				val2.material.color.copy( colors_for_names[val.name] );
				val2.material.needsUpdate = true;
			});
		}
	
	});


}

//TODO
//	support REST API
//	create user interface

